import axios from 'axios';
import tls from 'tls';
import { URL } from 'url';
import { query } from '../db';
import { emitToAll } from './socket';
import { triggerNotifications } from './notifier';
import logger from './logger';

// Map to keep track of active checking tasks (for fast manual triggers/throttling if needed)
const checkedTimes = new Map<string, number>();

export interface CheckResult {
  website_id: string;
  status_code: number | null;
  response_time: number;
  is_up: boolean;
  error_message: string | null;
  checked_at: Date;
  ssl_days_remaining: number | null;
}

// Utility to extract SSL Days Remaining asynchronously
export const getSSLCertificateDaysRemaining = (urlStr: string, timeoutMs: number = 5000): Promise<number | null> => {
  return new Promise((resolve) => {
    if (!urlStr.startsWith('https://')) {
      return resolve(null); // HTTP doesn't have SSL/TLS
    }

    try {
      const parsedUrl = new URL(urlStr);
      const host = parsedUrl.hostname;
      const port = parsedUrl.port ? parseInt(parsedUrl.port) : 443;

      let resolved = false;

      const socket = tls.connect({
        host,
        port,
        servername: host,
        rejectUnauthorized: false // Inspect certificate even if expired/self-signed
      }, () => {
        if (resolved) return;
        resolved = true;
        const cert = socket.getPeerCertificate();
        socket.destroy();

        if (cert && cert.valid_to) {
          const expiry = new Date(cert.valid_to);
          const now = new Date();
          const msRemaining = expiry.getTime() - now.getTime();
          const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
          resolve(daysRemaining);
        } else {
          resolve(null);
        }
      });

      socket.setTimeout(timeoutMs);
      socket.on('timeout', () => {
        if (resolved) return;
        resolved = true;
        socket.destroy();
        resolve(null);
      });

      socket.on('error', () => {
        if (resolved) return;
        resolved = true;
        socket.destroy();
        resolve(null);
      });
    } catch (error) {
      resolve(null);
    }
  });
};

export const performSingleCheck = async (website: any): Promise<CheckResult> => {
  const url = website.url;
  const timeoutMs = (website.timeout || 10) * 1000;
  const start = Date.now();
  
  let isUp = false;
  let statusCode: number | null = null;
  let errorMessage: string | null = null;

  // 1. Perform HTTP/HTTPS ping
  try {
    const response = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'UptimeMonitorCheck/1.0 (Self-Hosted Availability Service)'
      },
      validateStatus: () => true // Allow any status code so we can capture 4xx/5xx in code
    });

    statusCode = response.status;
    isUp = response.status >= 200 && response.status < 400;
    
    if (!isUp) {
      errorMessage = `Server returned status code ${response.status}`;
    }
  } catch (error: any) {
    isUp = false;
    errorMessage = error.message || 'Network connectivity error';
    if (error.code === 'ECONNABORTED') {
      errorMessage = `Request timed out after ${website.timeout || 10} seconds`;
    }
  }

  const responseTime = Date.now() - start;
  const checkedAt = new Date();

  // 2. Perform SSL Certificate check if HTTPS
  const sslDaysRemaining = await getSSLCertificateDaysRemaining(url, 5000);

  // 3. Save check results to database
  const { rows: insertRows } = await query(
    `INSERT INTO check_results (website_id, status_code, response_time, is_up, error_message, checked_at, ssl_days_remaining)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [website.id, statusCode, responseTime, isUp, errorMessage, checkedAt, sslDaysRemaining]
  );

  const result = insertRows[0];

  // Update memory tracker
  checkedTimes.set(website.id, checkedAt.getTime());

  // 4. DOWN / UP State change detection
  const { rows: prevRows } = await query(
    `SELECT is_up FROM check_results 
     WHERE website_id = $1 AND id != $2 
     ORDER BY checked_at DESC 
     LIMIT 1`,
    [website.id, result.id]
  );

  const hadPreviousState = prevRows.length > 0;
  const wasUp = hadPreviousState ? prevRows[0].is_up : true;

  const stateChanged = !hadPreviousState ? !isUp : (wasUp !== isUp);

  if (stateChanged) {
    logger.info(`[Monitor Service] Status transition: ${website.name} (${url}) is now ${isUp ? 'UP' : 'DOWN'}`);

    let alertId: string | null = null;

    if (!isUp) {
      const alertMsg = errorMessage || `Website is offline (Status code: ${statusCode})`;
      const { rows: alertRows } = await query(
        `INSERT INTO alerts (website_id, type, status, message, triggered_at)
         VALUES ($1, 'down', 'active', $2, $3)
         RETURNING id`,
        [website.id, alertMsg, checkedAt]
      );
      alertId = alertRows[0].id;

      triggerNotifications(website, 'down', alertMsg).catch(err => {
        logger.error('[Notifier] Error dispatching alerts:', { error: err.message });
      });
    } else {
      const { rows: activeAlerts } = await query(
        `UPDATE alerts 
         SET status = 'resolved', resolved_at = $1 
         WHERE website_id = $2 AND type = 'down' AND status = 'active'
         RETURNING id`,
        [checkedAt, website.id]
      );
      
      if (activeAlerts.length > 0) {
        alertId = activeAlerts[0].id;
      }

      const resolveMsg = `Website is back online. Response time: ${responseTime}ms.`;
      triggerNotifications(website, 'resolved', resolveMsg).catch(err => {
        logger.error('[Notifier] Error dispatching resolution alerts:', { error: err.message });
      });
    }

    emitToAll('website-status-changed', {
      websiteId: website.id,
      isUp,
      statusCode,
      responseTime,
      checkedAt,
      alertId,
      errorMessage,
      sslDaysRemaining
    });
  }

  // 5. SSL Certificate Expiration Warning triggers (Threshold: 14 days remaining)
  if (sslDaysRemaining !== null) {
    if (sslDaysRemaining <= 14) {
      // Check if there is already an active SSL alert
      const { rows: activeSslAlerts } = await query(
        `SELECT id FROM alerts WHERE website_id = $1 AND type = 'ssl_expiring' AND status = 'active'`,
        [website.id]
      );

      if (activeSslAlerts.length === 0) {
        const alertMsg = `SSL Certificate is expiring in ${sslDaysRemaining} days! (Warning threshold: 14 days)`;
        logger.warn(`[Monitor Service] SSL warning triggered for ${website.name}: ${alertMsg}`);
        
        await query(
          `INSERT INTO alerts (website_id, type, status, message, triggered_at)
           VALUES ($1, 'ssl_expiring', 'active', $2, $3)`,
          [website.id, alertMsg, checkedAt]
        );

        triggerNotifications(website, 'ssl_expiring' as any, alertMsg).catch(err => {
          logger.error('[Notifier] SSL Warning Alert enqueuing error:', { error: err.message });
        });
      }
    } else {
      // If healthy, check if we need to resolve a previously active SSL warning
      const { rows: resolvedSslAlerts } = await query(
        `UPDATE alerts 
         SET status = 'resolved', resolved_at = $1 
         WHERE website_id = $2 AND type = 'ssl_expiring' AND status = 'active'
         RETURNING id`,
        [checkedAt, website.id]
      );

      if (resolvedSslAlerts.length > 0) {
        const resolveMsg = `SSL Certificate has been successfully renewed. Days remaining: ${sslDaysRemaining}.`;
        logger.info(`[Monitor Service] SSL Warning resolved for ${website.name}`);
        
        triggerNotifications(website, 'resolved', resolveMsg).catch(err => {
          logger.error('[Notifier] SSL Resolve Alert enqueuing error:', { error: err.message });
        });
      }
    }
  }

  // 6. Emit generic check completed event (for live dashboards and graphs)
  emitToAll('check-completed', {
    websiteId: website.id,
    isUp,
    statusCode,
    responseTime,
    checkedAt,
    errorMessage,
    sslDaysRemaining
  });

  return {
    website_id: website.id,
    status_code: statusCode,
    response_time: responseTime,
    is_up: isUp,
    error_message: errorMessage,
    checked_at: checkedAt,
    ssl_days_remaining: sslDaysRemaining
  };
};

// Scheduler interval ID
let monitorIntervalId: NodeJS.Timeout | null = null;

export const startMonitoring = () => {
  if (monitorIntervalId) {
    clearInterval(monitorIntervalId);
  }

  logger.info('[Monitor Service] Initializing background check loop...');

  // Run a dispatcher tick every 10 seconds
  monitorIntervalId = setInterval(async () => {
    try {
      // Get all enabled websites
      const { rows: websites } = await query('SELECT * FROM websites WHERE enabled = TRUE');

      const now = Date.now();

      for (const website of websites) {
        const lastChecked = checkedTimes.get(website.id);
        const checkIntervalMs = (website.check_interval || 60) * 1000;

        // If never checked, or due for check
        if (!lastChecked || (now - lastChecked >= checkIntervalMs)) {
          // Update tracker immediately to throttle concurrent duplicate checks
          checkedTimes.set(website.id, now);

          // Perform check in background asynchronously
          performSingleCheck(website).catch((error) => {
            logger.error(`[Monitor Service] Check failed for ${website.name}:`, { error: error.message });
          });
        }
      }
    } catch (error: any) {
      logger.error('[Monitor Service] Error in check scheduling tick:', { error: error.message });
    }
  }, 10000); // Check schedule queue every 10s
};

export const stopMonitoring = () => {
  if (monitorIntervalId) {
    clearInterval(monitorIntervalId);
    monitorIntervalId = null;
    logger.info('[Monitor Service] Background check loop stopped.');
  }
};
