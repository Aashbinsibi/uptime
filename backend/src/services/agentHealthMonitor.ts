import { query } from '../db';
import { getIO } from './socket';
import logger from './logger';

let monitorInterval: NodeJS.Timeout | null = null;

export const startAgentHealthMonitor = () => {
  logger.info('[Agent Health Monitor] Starting heartbeat watchdog loop (15s interval)...');

  if (monitorInterval) {
    clearInterval(monitorInterval);
  }

  monitorInterval = setInterval(async () => {
    try {
      // Find servers with degraded or timed-out heartbeats
      const { rows: servers } = await query(`
        SELECT id, name, hostname, agent_status, last_heartbeat_at,
               EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at))::int as seconds_since_ping
        FROM servers
      `);

      for (const server of servers) {
        const seconds = server.seconds_since_ping || 999;
        let newStatus: string = server.agent_status;

        if (seconds > 90) {
          newStatus = 'OFFLINE';
        } else if (seconds > 30) {
          newStatus = 'DEGRADED';
        } else {
          newStatus = 'ONLINE';
        }

        if (newStatus !== server.agent_status) {
          await query(
            `UPDATE servers SET agent_status = $1, updated_at = NOW() WHERE id = $2`,
            [newStatus, server.id]
          );

          logger.warn(
            `[Agent Health Monitor] Server ${server.name} (${server.hostname}) status changed: ${server.agent_status} -> ${newStatus} (${seconds}s since last heartbeat)`
          );

          try {
            const io = getIO();
            io.emit('server-status-changed', {
              serverId: server.id,
              name: server.name,
              status: newStatus,
              secondsSincePing: seconds,
              updatedAt: new Date().toISOString()
            });
          } catch {
            // Socket might not be ready yet
          }
        }
      }
    } catch (error: any) {
      logger.error('[Agent Health Monitor] Error checking server heartbeat statuses:', { error: error?.message || String(error) });
    }
  }, 15000);
};

export const stopAgentHealthMonitor = () => {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
};
