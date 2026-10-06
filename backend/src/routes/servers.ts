import express, { Response } from 'express';
import { query } from '../db';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import logger from '../services/logger';
import crypto from 'crypto';

const router = express.Router();

/**
 * GET /api/servers
 * Retrieve all monitored servers with latest metrics snapshot
 */
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { rows: servers } = await query(`
      SELECT 
        s.*,
        EXTRACT(EPOCH FROM (NOW() - s.last_heartbeat_at))::int as seconds_since_ping,
        m.cpu_usage_percent as latest_cpu_percent,
        m.memory_usage_percent as latest_mem_percent,
        m.disk_usage_percent as latest_disk_percent,
        m.load_1m as latest_load_1m,
        m.docker_stats as latest_docker_stats,
        m.created_at as latest_metric_time
      FROM servers s
      LEFT JOIN LATERAL (
        SELECT cpu_usage_percent, memory_usage_percent, disk_usage_percent, load_1m, docker_stats, created_at
        FROM server_metrics
        WHERE server_id = s.id
        ORDER BY created_at DESC
        LIMIT 1
      ) m ON true
      ORDER BY s.created_at DESC
    `);

    res.json({
      success: true,
      data: servers
    });
  } catch (error: any) {
    logger.error('[Servers Route] Error fetching servers:', { error: error?.message || String(error) });
    res.status(500).json({ success: false, error: 'Failed to fetch servers' });
  }
});

/**
 * POST /api/servers/token
 * Generate an install token and copyable one-liner command
 */
router.post('/token', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { server_name, enable_docker } = req.body;

    const token = `upt_inst_${crypto.randomBytes(12).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await query(
      `INSERT INTO agent_install_tokens (token, user_id, server_name, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [token, userId || null, server_name || 'Production Host', expiresAt]
    );

    const host = req.get('host') || 'localhost';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const apiUrl = `${protocol}://${host}`;

    const dockerFlag = enable_docker ? '--enable-docker-monitoring' : '--disable-docker-monitoring';
    const nameFlag = server_name ? ` --name="${server_name}"` : '';

    const command = `curl -sSL "${apiUrl}/api/agent/install.sh?token=${token}" | sudo bash -s -- --token=${token} --api-url="${apiUrl}"${nameFlag} ${dockerFlag}`;

    res.json({
      success: true,
      token,
      expires_at: expiresAt,
      install_command: command
    });
  } catch (error: any) {
    logger.error('[Servers Route] Error generating install token:', { error: error?.message || String(error) });
    res.status(500).json({ success: false, error: 'Failed to generate installation command' });
  }
});

/**
 * GET /api/servers/:id
 * Retrieve details and historical timeseries metrics for a single server
 */
router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { rows: serverRows } = await query(
      `SELECT *, EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at))::int as seconds_since_ping 
       FROM servers 
       WHERE id = $1`,
      [id]
    );

    if (serverRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    const server = serverRows[0];

    // Fetch last 60 metrics data points
    const { rows: metrics } = await query(
      `SELECT * FROM server_metrics 
       WHERE server_id = $1 
       ORDER BY created_at DESC 
       LIMIT 60`,
      [id]
    );

    res.json({
      success: true,
      data: {
        server,
        metrics: metrics.reverse()
      }
    });
  } catch (error: any) {
    logger.error('[Servers Route] Error fetching server detail:', { error: error?.message || String(error) });
    res.status(500).json({ success: false, error: 'Failed to fetch server detail' });
  }
});

/**
 * DELETE /api/servers/:id
 * Delete a server and its metrics
 */
router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    await query(`DELETE FROM servers WHERE id = $1`, [id]);
    res.json({ success: true, message: 'Server deleted successfully' });
  } catch (error: any) {
    logger.error('[Servers Route] Error deleting server:', { error: error?.message || String(error) });
    res.status(500).json({ success: false, error: 'Failed to delete server' });
  }
});

/**
 * POST /api/servers/seed
 * Seed demo servers
 */
router.post('/seed', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { rows: existing } = await query('SELECT COUNT(*)::int as count FROM servers');
    if (existing[0].count > 0) {
      return res.json({ success: true, message: 'Servers already exist' });
    }

    // Insert demo servers
    await query(`
      INSERT INTO servers (name, hostname, ip_address, os_name, os_version, kernel_version, architecture, cpu_cores, cpu_model, total_memory_bytes, total_disk_bytes, agent_version, agent_status, docker_enabled, api_token)
      VALUES 
        ('server-prod-01 (API Gateway)', 'srv-prod-01', '172.31.28.14', 'Ubuntu', '24.04 LTS', '6.8.0-31-generic', 'amd64', 4, 'Intel Xeon Platinum 8375C', 17179869184, 268435456000, '0.1', 'ONLINE', true, 'upt_tok_srv_prod_01_seed')
    `);

    res.json({ success: true, message: 'Demo servers seeded successfully' });
  } catch (error: any) {
    logger.error('[Servers Route] Error seeding demo servers:', { error: error?.message || String(error) });
    res.status(500).json({ success: false, error: 'Failed to seed servers' });
  }
});

export default router;
