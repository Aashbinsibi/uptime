import express, { Request, Response } from 'express';
import { query } from '../db';
import { getIO } from '../services/socket';
import logger from '../services/logger';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const router = express.Router();

const AGENT_LATEST_VERSION = '0.1';
const AGENT_MIN_SUPPORTED_VERSION = '0.1';

/**
 * GET /api/agent/version
 * Returns supported version information
 */
router.get('/version', (req: Request, res: Response) => {
  res.json({
    success: true,
    current_version: AGENT_LATEST_VERSION,
    min_supported_version: AGENT_MIN_SUPPORTED_VERSION,
    release_notes: 'Gravity Agent 0.1: Production-hardened runtime, zero NVM dependency, systemd validation, CLI diagnostics, Docker capability flag for Uptime.'
  });
});

/**
 * GET /api/agent/source/:file
 * Serves agent source files for installer download
 */
router.get('/source/:file', (req: Request, res: Response) => {
  const { file } = req.params;
  const allowed = ['index.js', 'cli.js', 'package.json'];
  if (!allowed.includes(file)) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  const possiblePaths = [
    path.join(__dirname, '../../../agent/src', file),
    path.join(__dirname, '../../agent/src', file),
    path.join(process.cwd(), 'agent/src', file)
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      res.setHeader('Content-Type', 'application/javascript');
      return res.send(fs.readFileSync(p, 'utf8'));
    }
  }

  res.status(404).json({ success: false, error: 'Source file not found' });
});

/**
 * GET /api/agent/install/:token
 * Validates installation token and returns structured metadata
 */
router.get('/install/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const { rows } = await query(
      `SELECT token, server_name, expires_at, used 
       FROM agent_install_tokens 
       WHERE token = $1`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Installation token not found or already consumed'
      });
    }

    const tokenRecord = rows[0];
    if (new Date(tokenRecord.expires_at) < new Date()) {
      return res.status(410).json({
        success: false,
        error: 'Installation token has expired. Please generate a new install command.'
      });
    }

    res.json({
      success: true,
      token: tokenRecord.token,
      server_name: tokenRecord.server_name,
      agent_version: AGENT_LATEST_VERSION,
      heartbeat_interval: 30
    });
  } catch (error: any) {
    logger.error('[Agent API] Error validating install token:', { error: error?.message || String(error) });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/agent/register
 * Initial registration when agent starts up on a server
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const {
      token,
      server_name,
      hostname,
      ip_address,
      os_name,
      os_version,
      kernel_version,
      architecture,
      cpu_cores,
      cpu_model,
      total_memory_bytes,
      total_disk_bytes,
      agent_version,
      docker_enabled
    } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Registration token is required' });
    }

    // Check if token exists in agent_install_tokens
    const { rows: tokenRows } = await query(
      `SELECT token, user_id, server_name, expires_at, used 
       FROM agent_install_tokens 
       WHERE token = $1`,
      [token]
    );

    let userId: string | null = null;
    let serverName = server_name || hostname || 'Monitored Server';

    if (tokenRows.length > 0) {
      const t = tokenRows[0];
      if (new Date(t.expires_at) < new Date()) {
        return res.status(410).json({ success: false, error: 'Registration token expired' });
      }
      userId = t.user_id;

      // Prioritize explicit agent-sent server_name, then non-default token server_name, then hostname
      if (server_name && server_name.trim()) {
        serverName = server_name.trim();
      } else if (t.server_name && t.server_name !== 'Production Host') {
        serverName = t.server_name;
      } else {
        serverName = hostname || t.server_name || 'Monitored Server';
      }

      // Mark token as used
      await query(`UPDATE agent_install_tokens SET used = TRUE WHERE token = $1`, [token]);
    } else {
      // Check if this is an existing server re-registering via its api_token
      const { rows: existingServer } = await query(
        `SELECT id, user_id, name FROM servers WHERE api_token = $1`,
        [token]
      );
      if (existingServer.length > 0) {
        userId = existingServer[0].user_id;
        serverName = existingServer[0].name;
      } else {
        return res.status(401).json({ success: false, error: 'Invalid installation token' });
      }
    }

    // Generate dedicated persistent api_token for this server
    const apiToken = `upt_tok_${crypto.randomBytes(16).toString('hex')}`;

    // Insert or update server record
    const { rows: serverRows } = await query(
      `INSERT INTO servers (
        user_id, name, hostname, ip_address, os_name, os_version,
        kernel_version, architecture, cpu_cores, cpu_model,
        total_memory_bytes, total_disk_bytes, agent_version,
        agent_status, docker_enabled, api_token, last_heartbeat_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ONLINE', $14, $15, NOW())
      RETURNING id, name, api_token`,
      [
        userId,
        serverName,
        hostname || 'unknown-host',
        ip_address || req.ip,
        os_name || 'Linux',
        os_version || 'Generic',
        kernel_version || 'unknown',
        architecture || 'amd64',
        cpu_cores || 1,
        cpu_model || 'Standard CPU',
        total_memory_bytes || 0,
        total_disk_bytes || 0,
        agent_version || AGENT_LATEST_VERSION,
        docker_enabled ? true : false,
        apiToken
      ]
    );

    const newServer = serverRows[0];
    logger.info(`[Agent API] Server registered: ${newServer.name} (${newServer.id})`);

    try {
      const io = getIO();
      io.emit('server-registered', {
        id: newServer.id,
        name: newServer.name,
        hostname,
        agent_version
      });
    } catch {
      // ignore
    }

    res.json({
      success: true,
      message: 'Server registered successfully',
      server_id: newServer.id,
      api_token: newServer.api_token,
      heartbeat_interval: 30,
      metrics_interval: 15
    });
  } catch (error: any) {
    logger.error('[Agent API] Server registration error:', { error: error?.message || String(error) });
    res.status(500).json({ success: false, error: 'Failed to register server' });
  }
});

/**
 * POST /api/agent/heartbeat
 * Periodic agent heartbeat (every 30s)
 */
router.post('/heartbeat', async (req: Request, res: Response) => {
  try {
    const apiToken = (req.headers['x-agent-token'] as string) || req.body.token || req.body.api_token;
    const { server_id, agent_version, uptime_seconds, load_avg } = req.body;

    if (!apiToken && !server_id) {
      return res.status(401).json({ success: false, error: 'Agent authentication required' });
    }

    const { rows: servers } = await query(
      `SELECT id, name, hostname, agent_status 
       FROM servers 
       WHERE api_token = $1 OR id = $2`,
      [apiToken || '', server_id || '00000000-0000-0000-0000-000000000000']
    );

    if (servers.length === 0) {
      return res.status(404).json({ success: false, error: 'Server not recognized or deactivated' });
    }

    const server = servers[0];

    await query(
      `UPDATE servers 
       SET agent_status = 'ONLINE', 
           agent_version = COALESCE($1, agent_version),
           last_heartbeat_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [agent_version || AGENT_LATEST_VERSION, server.id]
    );

    try {
      const io = getIO();
      io.emit('server-heartbeat', {
        serverId: server.id,
        status: 'ONLINE',
        lastHeartbeatAt: new Date().toISOString(),
        uptimeSeconds: uptime_seconds,
        loadAvg: load_avg
      });
    } catch {
      // ignore
    }

    res.json({
      success: true,
      status: 'ACK',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('[Agent API] Heartbeat ingestion error:', { error: error?.message || String(error) });
    res.status(500).json({ success: false, error: 'Internal heartbeat error' });
  }
});

/**
 * POST /api/agent/metrics
 * Ingest telemetry metrics (CPU, RAM, Disk, Network, Processes, Docker)
 */
router.post('/metrics', async (req: Request, res: Response) => {
  try {
    const apiToken = (req.headers['x-agent-token'] as string) || req.body.token || req.body.api_token;
    const {
      server_id,
      cpu_usage_percent,
      load_1m,
      load_5m,
      load_15m,
      memory_used_bytes,
      memory_total_bytes,
      memory_usage_percent,
      swap_used_bytes,
      swap_total_bytes,
      disk_used_bytes,
      disk_total_bytes,
      disk_usage_percent,
      network_rx_bytes,
      network_tx_bytes,
      processes_count,
      top_processes,
      docker_stats
    } = req.body;

    const { rows: servers } = await query(
      `SELECT id, name, hostname, total_memory_bytes, total_disk_bytes 
       FROM servers 
       WHERE api_token = $1 OR id = $2`,
      [apiToken || '', server_id || '00000000-0000-0000-0000-000000000000']
    );

    if (servers.length === 0) {
      return res.status(401).json({ success: false, error: 'Unauthorized agent telemetry' });
    }

    const srv = servers[0];

    // Insert timeseries record
    await query(
      `INSERT INTO server_metrics (
        server_id, cpu_usage_percent, load_1m, load_5m, load_15m,
        memory_used_bytes, memory_total_bytes, memory_usage_percent,
        swap_used_bytes, swap_total_bytes,
        disk_used_bytes, disk_total_bytes, disk_usage_percent,
        network_rx_bytes, network_tx_bytes,
        processes_count, top_processes, docker_stats
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        srv.id,
        cpu_usage_percent || 0,
        load_1m || 0,
        load_5m || 0,
        load_15m || 0,
        memory_used_bytes || 0,
        memory_total_bytes || srv.total_memory_bytes || 0,
        memory_usage_percent || 0,
        swap_used_bytes || 0,
        swap_total_bytes || 0,
        disk_used_bytes || 0,
        disk_total_bytes || srv.total_disk_bytes || 0,
        disk_usage_percent || 0,
        network_rx_bytes || 0,
        network_tx_bytes || 0,
        processes_count || 0,
        JSON.stringify(top_processes || []),
        JSON.stringify(docker_stats || {})
      ]
    );

    // Update server's latest heartbeat and memory/disk totals if updated
    await query(
      `UPDATE servers 
       SET agent_status = 'ONLINE',
           last_heartbeat_at = NOW(),
           total_memory_bytes = COALESCE(NULLIF($1::bigint, 0), total_memory_bytes),
           total_disk_bytes = COALESCE(NULLIF($2::bigint, 0), total_disk_bytes)
       WHERE id = $3`,
      [memory_total_bytes || 0, disk_total_bytes || 0, srv.id]
    );

    // Broadcast to connected frontend clients
    try {
      const io = getIO();
      io.emit('server-metrics-updated', {
        serverId: srv.id,
        cpu_usage_percent,
        load_1m,
        memory_usage_percent,
        disk_usage_percent,
        docker_stats,
        timestamp: new Date().toISOString()
      });
    } catch {
      // ignore
    }

    res.json({ success: true, message: 'Metrics recorded' });
  } catch (error: any) {
    logger.error('[Agent API] Metrics ingestion error:', { error: error?.message || String(error) });
    res.status(500).json({ success: false, error: 'Failed to record metrics' });
  }
});

/**
 * GET /api/agent/install.sh
 * Serves the production-grade bash installer script
 */
router.get('/install.sh', (req: Request, res: Response) => {
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const defaultApiUrl = `${protocol}://${host}`;
  const queryToken = (req.query.token as string) || '';

  const possibleScriptPaths = [
    path.join(__dirname, '../../../agent/install.sh'),
    path.join(__dirname, '../../agent/install.sh'),
    path.join(process.cwd(), 'agent/install.sh')
  ];

  let scriptContent = '';
  for (const p of possibleScriptPaths) {
    if (fs.existsSync(p)) {
      scriptContent = fs.readFileSync(p, 'utf8');
      break;
    }
  }

  if (!scriptContent) {
    return res.status(500).send('#!/bin/bash\necho "Error: Installer script not found on server" && exit 1\n');
  }

  // Inject default values dynamically if needed
  if (queryToken) {
    scriptContent = scriptContent.replace(
      'INSTALL_TOKEN="${INSTALL_TOKEN:-}"',
      `INSTALL_TOKEN="\${INSTALL_TOKEN:-${queryToken}}"`
    );
  }
  scriptContent = scriptContent.replace(
    'API_URL="${API_URL:-http://localhost:3000}"',
    `API_URL="\${API_URL:-${defaultApiUrl}}"`
  );

  res.setHeader('Content-Type', 'text/x-shellscript');
  res.setHeader('Content-Disposition', 'inline; filename="install.sh"');
  res.send(scriptContent);
});

export default router;
