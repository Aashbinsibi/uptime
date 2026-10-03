const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

// Load environment variables from /etc/gravity/agent.env or /etc/uptime/agent.env or local .env
const CONFIG_FILE = process.env.GRAVITY_CONFIG || process.env.UPTIME_CONFIG || (
  fs.existsSync('/etc/gravity/agent.env') ? '/etc/gravity/agent.env' : '/etc/uptime/agent.env'
);
const config = {};
if (fs.existsSync(CONFIG_FILE)) {
  const lines = fs.readFileSync(CONFIG_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const k = trimmed.substring(0, idx).trim();
        const v = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
        config[k] = v;
      }
    }
  }
}

const API_URL = config.API_URL || process.env.API_URL || 'http://localhost:3000';
let API_TOKEN = config.API_TOKEN || process.env.API_TOKEN || '';
let SERVER_ID = config.SERVER_ID || process.env.SERVER_ID || '';
const AGENT_VERSION = '0.1';
const DOCKER_ENABLED = config.DOCKER_ENABLED === 'true';

console.log(`[Gravity Agent v${AGENT_VERSION}] Initializing infrastructure daemon for Uptime...`);
console.log(`[Gravity Agent] Target API: ${API_URL}`);
console.log(`[Gravity Agent] Host: ${os.hostname()} (${os.platform()} ${os.arch()})`);

function sendRequest(endpoint, payload, method = 'POST') {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(API_URL + endpoint);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const bodyData = JSON.stringify(payload);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyData),
          'X-Agent-Token': API_TOKEN,
          'User-Agent': `Gravity-Agent/${AGENT_VERSION}`
        },
        timeout: 10000
      };

      const req = client.request(options, (res) => {
        let resData = '';
        res.on('data', chunk => resData += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(resData);
            resolve(parsed);
          } catch (e) {
            resolve({ raw: resData, statusCode: res.statusCode });
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      req.write(bodyData);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// 1. Initial Host Registration
async function registerHost() {
  if (SERVER_ID && API_TOKEN) {
    console.log(`[Gravity Agent] Server already registered (ID: ${SERVER_ID})`);
    return;
  }

  console.log('[Gravity Agent] Registering server with Uptime console...');
  const cpus = os.cpus() || [];
  const totalMem = os.totalmem();

  let totalDisk = 0;
  try {
    const dfOut = execSync("df -B1 / | tail -1", { encoding: 'utf8' }).trim().split(/\s+/);
    totalDisk = parseInt(dfOut[1], 10) || 0;
  } catch (e) {}

  const regData = {
    token: config.INSTALL_TOKEN || API_TOKEN,
    server_name: config.SERVER_NAME || undefined,
    hostname: os.hostname(),
    os_name: os.type(),
    os_version: os.release(),
    kernel_version: os.version ? os.version() : os.release(),
    architecture: os.arch(),
    cpu_cores: cpus.length,
    cpu_model: cpus[0] ? cpus[0].model : 'Standard Processor',
    total_memory_bytes: totalMem,
    total_disk_bytes: totalDisk,
    agent_version: AGENT_VERSION,
    docker_enabled: DOCKER_ENABLED
  };

  try {
    const res = await sendRequest('/api/agent/register', regData);
    if (res.success && res.server_id && res.api_token) {
      SERVER_ID = res.server_id;
      API_TOKEN = res.api_token;
      
      // Persist credentials securely
      fs.appendFileSync(CONFIG_FILE, `\nSERVER_ID=${SERVER_ID}\nAPI_TOKEN=${API_TOKEN}\n`);
      try {
        fs.chmodSync(CONFIG_FILE, 0o600);
      } catch (e) {}
      console.log(`[Gravity Agent] Host registered successfully. Server ID: ${SERVER_ID}`);
    } else {
      console.error('[Gravity Agent] Registration rejected by server:', res.error);
    }
  } catch (err) {
    console.error('[Gravity Agent] Host registration failed:', err.message);
  }
}

// 2. Heartbeat Ping (30s)
async function sendHeartbeat() {
  if (!API_TOKEN) return;
  try {
    const res = await sendRequest('/api/agent/heartbeat', {
      server_id: SERVER_ID,
      token: API_TOKEN,
      agent_version: AGENT_VERSION,
      uptime_seconds: Math.floor(os.uptime()),
      load_avg: os.loadavg()
    });
    if (res.success) {
      // heartbeat acknowledged
    }
  } catch (err) {
    console.warn(`[Gravity Agent] Heartbeat ping failed: ${err.message}`);
  }
}

// 3. System Metrics Telemetry (15s)
let prevCpuTimes = null;
function getCpuUsagePercent() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  if (!prevCpuTimes) {
    prevCpuTimes = { idle: totalIdle, total: totalTick };
    return 5.0; // Initial default estimate
  }

  const idleDelta = totalIdle - prevCpuTimes.idle;
  const totalDelta = totalTick - prevCpuTimes.total;
  prevCpuTimes = { idle: totalIdle, total: totalTick };

  if (totalDelta <= 0) return 0.0;
  const usage = 100 - Math.round((100 * idleDelta) / totalDelta);
  return Math.max(0, Math.min(100, usage));
}

function getTopProcesses() {
  try {
    const psOut = execSync('ps -eo pid,%cpu,%mem,user,comm --sort=-%cpu | head -n 6', { encoding: 'utf8' });
    const lines = psOut.trim().split('\n').slice(1);
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parseInt(parts[0], 10),
        cpu: parseFloat(parts[1]) || 0,
        mem: parseFloat(parts[2]) || 0,
        user: parts[3],
        name: parts[4]
      };
    });
  } catch (e) {
    return [];
  }
}

function getDockerStats() {
  if (!DOCKER_ENABLED) return { active_containers: 0, total_containers: 0, containers: [] };
  try {
    const raw = execSync('docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}"', { encoding: 'utf8' });
    const lines = raw.trim().split('\n').filter(Boolean);
    const containers = lines.slice(0, 10).map(line => {
      const [id, name, image, state, status] = line.split('|');
      return { id, name, image, state, status };
    });
    const running = containers.filter(c => c.state === 'running').length;
    return {
      active_containers: running,
      total_containers: containers.length,
      containers
    };
  } catch (e) {
    return { active_containers: 0, total_containers: 0, containers: [], error: 'Docker socket inaccessible' };
  }
}

async function collectAndSendMetrics() {
  if (!API_TOKEN) return;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = Math.round((usedMem / totalMem) * 100);
  const load = os.loadavg();
  const cpuPercent = getCpuUsagePercent();

  let diskUsed = 0, diskTotal = 0, diskPercent = 0;
  try {
    const df = execSync("df -B1 / | tail -1", { encoding: 'utf8' }).trim().split(/\s+/);
    diskTotal = parseInt(df[1], 10) || 0;
    diskUsed = parseInt(df[2], 10) || 0;
    diskPercent = parseFloat(df[4].replace('%', '')) || 0;
  } catch (e) {}

  const payload = {
    server_id: SERVER_ID,
    token: API_TOKEN,
    cpu_usage_percent: cpuPercent,
    load_1m: load[0],
    load_5m: load[1],
    load_15m: load[2],
    memory_used_bytes: usedMem,
    memory_total_bytes: totalMem,
    memory_usage_percent: memPercent,
    disk_used_bytes: diskUsed,
    disk_total_bytes: diskTotal,
    disk_usage_percent: diskPercent,
    top_processes: getTopProcesses(),
    docker_stats: getDockerStats()
  };

  try {
    await sendRequest('/api/agent/metrics', payload);
  } catch (err) {
    // network retry
  }
}

// Start Lifecycle
async function start() {
  await registerHost();
  await sendHeartbeat();
  await collectAndSendMetrics();

  setInterval(sendHeartbeat, 30000);
  setInterval(collectAndSendMetrics, 15000);
  console.log('[Gravity Agent] Monitoring loops active. Heartbeat: 30s, Telemetry: 15s.');
}

start().catch(err => {
  console.error('[Gravity Agent] Fatal startup error:', err);
  process.exit(1);
});
