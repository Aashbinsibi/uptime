#!/usr/bin/env node
/**
 * Gravity Infrastructure Monitoring Agent CLI (Uptime Suite)
 * Command-Line Management Tool for the Gravity Host Daemon
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');

const CURRENT_VERSION = '0.1';
const SERVICE_NAME = 'gravity-agent';
const CONFIG_PATHS = ['/etc/gravity/agent.env', '/etc/uptime/agent.env'];
const INSTALL_DIR = '/opt/gravity/agent';

// ANSI color helpers
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    return (err.stdout || err.stderr || err.message || '').toString();
  }
}

function loadConfig() {
  for (const cfgPath of CONFIG_PATHS) {
    if (fs.existsSync(cfgPath)) {
      const content = fs.readFileSync(cfgPath, 'utf8');
      const lines = content.split('\n');
      const cfg = { _path: cfgPath };
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          cfg[key] = val;
        }
      }
      return cfg;
    }
  }
  return null;
}

function httpGet(targetUrl, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(targetUrl);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.get(parsed, { timeout: timeoutMs }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, headers: res.headers, data: JSON.parse(data) });
          } catch {
            resolve({ statusCode: res.statusCode, headers: res.headers, raw: data });
          }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Connection to ${targetUrl} timed out after ${timeoutMs}ms`));
      });
      req.on('error', err => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

function printBanner() {
  console.log(`${c.bold}${c.cyan}┌────────────────────────────────────────────────────────┐${c.reset}`);
  console.log(`${c.bold}${c.cyan}│${c.reset}  ${c.bold}Gravity Infrastructure Monitoring Agent${c.reset} ${c.green}v${CURRENT_VERSION}${c.reset} (Uptime)   ${c.bold}${c.cyan}│${c.reset}`);
  console.log(`${c.bold}${c.cyan}└────────────────────────────────────────────────────────┘${c.reset}`);
}

async function handleStatus() {
  printBanner();
  console.log(`\n${c.bold}● Daemon Status:${c.reset}`);

  const activeRaw = run(`systemctl is-active ${SERVICE_NAME}`).trim();
  const enabledRaw = run(`systemctl is-enabled ${SERVICE_NAME}`).trim();
  const isActive = activeRaw === 'active';
  const isEnabled = enabledRaw === 'enabled';

  console.log(`  State:            ${isActive ? `${c.green}● ACTIVE (Running)${c.reset}` : `${c.red}● INACTIVE (${activeRaw})${c.reset}`}`);
  console.log(`  Auto-Start:       ${isEnabled ? `${c.green}Enabled on boot${c.reset}` : `${c.yellow}${enabledRaw}${c.reset}`}`);

  // Fetch PID and memory via systemctl
  const mainPid = run(`systemctl show -p MainPID --value ${SERVICE_NAME}`).trim();
  if (mainPid && mainPid !== '0') {
    console.log(`  PID:              ${c.cyan}${mainPid}${c.reset}`);
    const memUsage = run(`systemctl show -p MemoryCurrent --value ${SERVICE_NAME}`).trim();
    if (memUsage && memUsage !== '[not set]') {
      const mb = (parseInt(memUsage, 10) / (1024 * 1024)).toFixed(1);
      console.log(`  Memory Usage:     ${mb} MB`);
    }
    const activeSince = run(`systemctl show -p ActiveEnterTimestamp --value ${SERVICE_NAME}`).trim();
    if (activeSince) {
      console.log(`  Active Since:     ${activeSince}`);
    }
  }

  const config = loadConfig();
  console.log(`\n${c.bold}● Fleet Configuration:${c.reset}`);
  if (config) {
    console.log(`  Config File:      ${c.green}${config._path}${c.reset}`);
    console.log(`  API Endpoint:     ${c.cyan}${config.API_URL || 'Not specified'}${c.reset}`);
    console.log(`  Server Name:      ${config.SERVER_NAME || '(auto-detected hostname)'}`);
    console.log(`  Server ID:        ${config.SERVER_ID || `${c.yellow}Awaiting initial registration${c.reset}`}`);
    console.log(`  Docker Monitored: ${config.DOCKER_ENABLED === 'true' ? `${c.green}Enabled${c.reset}` : `${c.dim}Disabled${c.reset}`}`);
  } else {
    console.log(`  Config File:      ${c.red}Missing (/etc/gravity/agent.env)${c.reset}`);
  }

  console.log(`\n${c.dim}Tip: Run "gravity logs" to view telemetry logs or "gravity health" to test connections.${c.reset}`);
}

async function handleHealth() {
  printBanner();
  console.log(`\n${c.bold}Running End-to-End Subsystem Health Verification...${c.reset}\n`);

  let allHealthy = true;

  // 1. Config Check
  process.stdout.write(`  [1/5] Checking configuration file... `);
  const config = loadConfig();
  if (config && config.API_URL) {
    console.log(`${c.green}✓ OK${c.reset} (${config._path})`);
  } else {
    console.log(`${c.red}✗ FAILED${c.reset} (Missing /etc/gravity/agent.env)`);
    allHealthy = false;
  }

  // 2. Service Unit Check
  process.stdout.write(`  [2/5] Checking systemd daemon active state... `);
  const activeState = run(`systemctl is-active ${SERVICE_NAME}`).trim();
  if (activeState === 'active') {
    console.log(`${c.green}✓ ACTIVE${c.reset}`);
  } else {
    console.log(`${c.red}✗ INACTIVE (${activeState})${c.reset}`);
    allHealthy = false;
  }

  // 3. Network & API Connectivity Check
  process.stdout.write(`  [3/5] Testing connectivity to Uptime API server... `);
  if (config && config.API_URL) {
    try {
      const verUrl = `${config.API_URL.replace(/\/$/, '')}/api/agent/version`;
      const res = await httpGet(verUrl, 5000);
      if (res.statusCode === 200 && res.data && res.data.success) {
        console.log(`${c.green}✓ CONNECTED${c.reset} (Server agent latest: v${res.data.current_version})`);
      } else {
        console.log(`${c.yellow}⚠ WARN${c.reset} (HTTP ${res.statusCode} from ${verUrl})`);
      }
    } catch (err) {
      console.log(`${c.red}✗ UNREACHABLE${c.reset} (${err.message})`);
      allHealthy = false;
    }
  } else {
    console.log(`${c.yellow}SKIPPED (no API_URL configured)${c.reset}`);
  }

  // 4. Host Resource Telemetry Check
  process.stdout.write(`  [4/5] Reading host telemetry metrics... `);
  try {
    const cpus = os.cpus();
    const load = os.loadavg();
    const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
    const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
    console.log(`${c.green}✓ OK${c.reset} (${cpus.length} cores, Load 1m: ${load[0].toFixed(2)}, RAM: ${freeMemMb}/${totalMemMb} MB free)`);
  } catch (err) {
    console.log(`${c.red}✗ ERROR${c.reset} (${err.message})`);
    allHealthy = false;
  }

  // 5. Container Environment Check
  process.stdout.write(`  [5/5] Checking container telemetry socket... `);
  const hasDockerSock = fs.existsSync('/var/run/docker.sock');
  if (hasDockerSock) {
    try {
      fs.accessSync('/var/run/docker.sock', fs.constants.R_OK);
      console.log(`${c.green}✓ OK${c.reset} (Docker socket readable)`);
    } catch {
      console.log(`${c.yellow}⚠ PERMISSION NOTICE${c.reset} (Socket present but requires 'docker' group permission)`);
    }
  } else {
    console.log(`${c.dim}N/A (Docker socket not present on host)${c.reset}`);
  }

  console.log('\n────────────────────────────────────────────────────────');
  if (allHealthy) {
    console.log(`${c.bold}${c.green}✓ Overall System Health: OPTIMAL${c.reset}`);
  } else {
    console.log(`${c.bold}${c.red}✗ Overall System Health: ISSUES DETECTED${c.reset}`);
    console.log(`Run ${c.cyan}gravity logs${c.reset} or ${c.cyan}gravity diagnose${c.reset} for detailed logs.`);
  }
}

async function handleDiagnose() {
  printBanner();
  console.log(`\n${c.bold}Comprehensive Diagnostic Report${c.reset}`);
  console.log('────────────────────────────────────────────────────────');

  console.log(`${c.bold}Host Information:${c.reset}`);
  console.log(`  Hostname:         ${os.hostname()}`);
  console.log(`  OS Platform:      ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`  Kernel:           ${os.version ? os.version() : os.release()}`);
  console.log(`  CPU Cores:        ${os.cpus().length}`);
  console.log(`  Total Memory:     ${(os.totalmem() / (1024 * 1024 * 1024)).toFixed(2)} GB`);
  console.log(`  System Uptime:    ${(os.uptime() / 3600).toFixed(1)} hours`);

  console.log(`\n${c.bold}Runtime & Paths:${c.reset}`);
  console.log(`  Node Binary:      ${process.execPath}`);
  console.log(`  Node Version:     ${process.version}`);
  console.log(`  Script Location:  ${__filename}`);
  console.log(`  Install Dir:      ${INSTALL_DIR}`);

  const config = loadConfig();
  console.log(`\n${c.bold}Configuration Audit:${c.reset}`);
  if (config) {
    console.log(`  Config Path:      ${config._path}`);
    console.log(`  API_URL:          ${config.API_URL || '(empty)'}`);
    console.log(`  SERVER_ID:        ${config.SERVER_ID || '(pending)'}`);
    console.log(`  API_TOKEN:        ${config.API_TOKEN ? `${config.API_TOKEN.slice(0, 12)}... [SECURED]` : '(none)'}`);
    console.log(`  DOCKER_ENABLED:   ${config.DOCKER_ENABLED}`);
  } else {
    console.log(`  ${c.red}No valid config file detected in /etc/gravity or /etc/uptime${c.reset}`);
  }

  console.log(`\n${c.bold}Service State:${c.reset}`);
  console.log(`  systemd active:   ${run(`systemctl is-active ${SERVICE_NAME}`).trim()}`);
  console.log(`  systemd enabled:  ${run(`systemctl is-enabled ${SERVICE_NAME}`).trim()}`);

  console.log(`\n${c.bold}Recent Daemon Telemetry Logs (Last 10 entries):${c.reset}`);
  console.log(run(`journalctl -u ${SERVICE_NAME} -n 10 --no-pager`));
}

async function handleVersion() {
  console.log(`${c.bold}Gravity Infrastructure Agent${c.reset} v${c.cyan}${CURRENT_VERSION}${c.reset} (Uptime Suite)`);
  console.log(`Runtime: ${process.version} (${process.execPath})`);
  console.log(`Architecture: ${os.arch()}-${os.platform()}`);

  const config = loadConfig();
  if (config && config.API_URL) {
    try {
      const verUrl = `${config.API_URL.replace(/\/$/, '')}/api/agent/version`;
      const res = await httpGet(verUrl, 4000);
      if (res.statusCode === 200 && res.data && res.data.current_version) {
        const latest = res.data.current_version;
        if (latest !== CURRENT_VERSION) {
          console.log(`\n${c.yellow}★ Update Available!${c.reset} Latest version is ${c.green}v${latest}${c.reset} (Current: v${CURRENT_VERSION})`);
          console.log(`  Run ${c.cyan}sudo gravity upgrade${c.reset} to update automatically.`);
        } else {
          console.log(`\n${c.green}✓ Agent is on the latest version (v${CURRENT_VERSION}).${c.reset}`);
        }
      }
    } catch {
      // Ignore network errors on version check
    }
  }
}

async function handleLogs() {
  const args = process.argv.slice(3);
  let follow = false;
  let count = '50';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-f' || args[i] === '--follow') {
      follow = true;
    } else if (args[i] === '-n' && args[i + 1]) {
      count = args[i + 1];
      i++;
    } else if (/^\d+$/.test(args[i])) {
      count = args[i];
    }
  }

  if (follow) {
    console.log(`${c.dim}Streaming live logs from ${SERVICE_NAME} (Ctrl+C to exit)...${c.reset}\n`);
    const child = spawn('journalctl', ['-u', SERVICE_NAME, '-f', '-n', count], { stdio: 'inherit' });
    child.on('error', err => console.error('Failed to spawn journalctl:', err.message));
  } else {
    console.log(run(`journalctl -u ${SERVICE_NAME} -n ${count} --no-pager`));
  }
}

async function handleServiceControl(action) {
  const isRoot = process.getuid && process.getuid() === 0;
  if (!isRoot) {
    console.error(`${c.red}Permission denied:${c.reset} Managing systemd services requires root privileges.`);
    console.error(`Please run: ${c.cyan}sudo gravity ${action}${c.reset}`);
    process.exit(1);
  }

  console.log(`Executing ${c.cyan}systemctl ${action} ${SERVICE_NAME}${c.reset}...`);
  run(`systemctl ${action} ${SERVICE_NAME}`);

  if (action === 'start' || action === 'restart') {
    const active = run(`systemctl is-active ${SERVICE_NAME}`).trim();
    if (active === 'active') {
      console.log(`${c.green}✓ Gravity Agent is running (ACTIVE)${c.reset}`);
    } else {
      console.error(`${c.red}✗ Failed to start agent. State: ${active}${c.reset}`);
      console.log(run(`journalctl -u ${SERVICE_NAME} -n 5 --no-pager`));
    }
  } else if (action === 'stop') {
    console.log(`${c.green}✓ Gravity Agent service stopped.${c.reset}`);
  }
}

async function handleConfig() {
  printBanner();
  const config = loadConfig();
  if (!config) {
    console.error(`\n${c.red}No configuration file found in /etc/gravity/agent.env${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}Configuration (/etc/gravity/agent.env):${c.reset}`);
  console.log('────────────────────────────────────────────────────────');
  for (const [key, val] of Object.entries(config)) {
    if (key === '_path') continue;
    let displayVal = val;
    if (key.includes('TOKEN') && val.length > 8) {
      displayVal = `${val.slice(0, 8)}...**************** (${val.length} chars)`;
    }
    console.log(`  ${c.cyan}${key.padEnd(20)}${c.reset} = ${displayVal}`);
  }
  console.log('────────────────────────────────────────────────────────');
}

async function handleUpgrade() {
  const isRoot = process.getuid && process.getuid() === 0;
  if (!isRoot) {
    console.error(`${c.red}Permission denied:${c.reset} Upgrading the agent requires root privileges.`);
    console.error(`Please run: ${c.cyan}sudo gravity upgrade${c.reset}`);
    process.exit(1);
  }

  printBanner();
  console.log(`\n${c.bold}Initiating Gravity Agent In-Place Upgrade...${c.reset}\n`);

  const config = loadConfig();
  if (!config || !config.API_URL) {
    console.error(`${c.red}Error:${c.reset} Cannot upgrade: Missing API_URL in /etc/gravity/agent.env`);
    process.exit(1);
  }

  const apiUrl = config.API_URL.replace(/\/$/, '');
  console.log(`  Contacting Uptime server at ${c.cyan}${apiUrl}${c.reset}...`);

  let targetVersion = CURRENT_VERSION;
  try {
    const verRes = await httpGet(`${apiUrl}/api/agent/version`, 6000);
    if (verRes.statusCode === 200 && verRes.data && verRes.data.current_version) {
      targetVersion = verRes.data.current_version;
      console.log(`  Latest release on server: ${c.green}v${targetVersion}${c.reset} (Local: v${CURRENT_VERSION})`);
    } else {
      console.log(`${c.yellow}Warning: Could not retrieve server version. Attempting code update anyway.${c.reset}`);
    }
  } catch (err) {
    console.error(`${c.red}Connection error:${c.reset} ${err.message}`);
    process.exit(1);
  }

  const force = process.argv.includes('--force');
  if (targetVersion === CURRENT_VERSION && !force) {
    console.log(`\n${c.green}✓ Gravity Agent is already up to date (v${CURRENT_VERSION}).${c.reset}`);
    console.log(`Pass ${c.cyan}--force${c.reset} to re-download and re-install anyway.`);
    return;
  }

  console.log(`\n  Downloading updated daemon files into ${INSTALL_DIR}/src...`);
  const filesToDownload = ['index.js', 'cli.js', 'package.json'];
  const srcDir = path.join(INSTALL_DIR, 'src');

  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir, { recursive: true });
  }

  for (const file of filesToDownload) {
    process.stdout.write(`    • Updating ${file}... `);
    try {
      const fileUrl = `${apiUrl}/api/agent/source/${file}`;
      const res = await httpGet(fileUrl, 8000);
      const content = res.raw || (typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2));
      const targetPath = file === 'package.json' ? path.join(INSTALL_DIR, file) : path.join(srcDir, file);
      fs.writeFileSync(targetPath, content, 'utf8');
      if (file === 'cli.js') {
        fs.chmodSync(targetPath, 0o755);
      }
      console.log(`${c.green}✓${c.reset}`);
    } catch (err) {
      console.log(`${c.red}✗ (${err.message})${c.reset}`);
    }
  }

  // Update version in config file
  try {
    if (config._path && fs.existsSync(config._path)) {
      let cfgText = fs.readFileSync(config._path, 'utf8');
      if (cfgText.includes('GRAVITY_VERSION=')) {
        cfgText = cfgText.replace(/GRAVITY_VERSION=.*/g, `GRAVITY_VERSION=${targetVersion}`);
      } else {
        cfgText += `\nGRAVITY_VERSION=${targetVersion}\n`;
      }
      fs.writeFileSync(config._path, cfgText, 'utf8');
    }
  } catch {}

  console.log(`\n  Restarting ${SERVICE_NAME} with updated version...`);
  run(`systemctl restart ${SERVICE_NAME}`);

  const active = run(`systemctl is-active ${SERVICE_NAME}`).trim();
  if (active === 'active') {
    console.log(`\n${c.bold}${c.green}✓ Successfully upgraded Gravity Agent to v${targetVersion}!${c.reset}`);
    console.log(`  Service: ACTIVE · Next heartbeat will report v${targetVersion} to Uptime console.`);
  } else {
    console.error(`\n${c.bold}${c.red}✗ Daemon failed to start after upgrade. State: ${active}${c.reset}`);
    console.log(run(`journalctl -u ${SERVICE_NAME} -n 10 --no-pager`));
  }
}

async function handleUninstall() {
  const isRoot = process.getuid && process.getuid() === 0;
  if (!isRoot) {
    console.error(`${c.red}Permission denied:${c.reset} Uninstalling the agent requires root privileges.`);
    console.error(`Please run: ${c.cyan}sudo gravity uninstall [--purge]${c.reset}`);
    process.exit(1);
  }

  const purge = process.argv.includes('--purge');

  printBanner();
  console.log(`\n${c.bold}Uninstalling Gravity Monitoring Agent...${c.reset}`);

  // 1. Stop service
  process.stdout.write(`  [1/4] Stopping ${SERVICE_NAME}... `);
  run(`systemctl stop ${SERVICE_NAME} 2>/dev/null || true`);
  console.log(`${c.green}✓${c.reset}`);

  // 2. Disable service
  process.stdout.write(`  [2/4] Disabling systemd service... `);
  run(`systemctl disable ${SERVICE_NAME} 2>/dev/null || true`);
  run(`rm -f /etc/systemd/system/${SERVICE_NAME}.service`);
  run('systemctl daemon-reload');
  run('systemctl reset-failed 2>/dev/null || true');
  console.log(`${c.green}✓${c.reset}`);

  // 3. Remove CLI symlinks
  process.stdout.write(`  [3/4] Removing CLI wrappers... `);
  run('rm -f /usr/local/bin/gravity /usr/local/bin/gravity-agent /usr/local/bin/uptime-agent');
  console.log(`${c.green}✓${c.reset}`);

  // 4. Clean directories
  if (purge) {
    process.stdout.write(`  [4/4] Purging configuration, runtime, and user (due to --purge)... `);
    run('rm -rf /opt/gravity /etc/gravity /var/log/gravity');
    run('userdel gravity 2>/dev/null || true');
    console.log(`${c.green}✓${c.reset}`);
  } else {
    console.log(`  [4/4] Preserving configuration in /etc/gravity and /opt/gravity.`);
    console.log(`        ${c.dim}(Pass --purge to remove all config and runtime directories)${c.reset}`);
  }

  console.log('\n────────────────────────────────────────────────────────');
  console.log(`${c.bold}${c.green}✓ Gravity Agent has been uninstalled successfully.${c.reset}`);
}

function handleHelp() {
  printBanner();
  console.log(`\n${c.bold}Usage:${c.reset} gravity <command> [options]\n`);
  console.log(`${c.bold}Commands:${c.reset}`);
  console.log(`  ${c.cyan}status${c.reset}                 Inspect systemd daemon state, PID, memory, and registration`);
  console.log(`  ${c.cyan}health${c.reset}                 Run live end-to-end subsystem diagnostics & connectivity test`);
  console.log(`  ${c.cyan}diagnose${c.reset}               Generate comprehensive technical diagnostic report`);
  console.log(`  ${c.cyan}logs${c.reset} [-n 50] [-f]      Inspect recent telemetry logs or stream live (-f)`);
  console.log(`  ${c.cyan}config${c.reset}                 Display current host configuration with masked tokens`);
  console.log(`  ${c.cyan}version${c.reset}                Display installed version and check for available updates`);
  console.log(`  ${c.cyan}upgrade${c.reset} [--force]      Perform in-place seamless upgrade to the newest release`);
  console.log(`  ${c.cyan}start${c.reset}                  Start the background systemd daemon (requires sudo)`);
  console.log(`  ${c.cyan}stop${c.reset}                   Stop the background systemd daemon (requires sudo)`);
  console.log(`  ${c.cyan}restart${c.reset}                Restart the background systemd daemon (requires sudo)`);
  console.log(`  ${c.cyan}uninstall${c.reset} [--purge]    Stop, disable, and remove daemon (add --purge to delete all files)`);
  console.log(`  ${c.cyan}help${c.reset}                   Display this help manual\n`);
  console.log(`${c.bold}Examples:${c.reset}`);
  console.log(`  gravity status`);
  console.log(`  gravity health`);
  console.log(`  gravity logs -f`);
  console.log(`  sudo gravity upgrade`);
  console.log(`  sudo gravity uninstall --purge\n`);
}

// Command router
const cmd = process.argv[2] || 'help';

switch (cmd) {
  case 'status':
    handleStatus();
    break;
  case 'health':
    handleHealth();
    break;
  case 'diagnose':
    handleDiagnose();
    break;
  case 'version':
  case '-v':
  case '--version':
    handleVersion();
    break;
  case 'logs':
  case 'log':
    handleLogs();
    break;
  case 'config':
    handleConfig();
    break;
  case 'start':
    handleServiceControl('start');
    break;
  case 'stop':
    handleServiceControl('stop');
    break;
  case 'restart':
    handleServiceControl('restart');
    break;
  case 'upgrade':
  case 'update':
    handleUpgrade();
    break;
  case 'uninstall':
  case 'remove':
    handleUninstall();
    break;
  case 'help':
  case '--help':
  case '-h':
  default:
    handleHelp();
    break;
}
