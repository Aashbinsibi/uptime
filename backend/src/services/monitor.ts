import axios from 'axios';
import { query } from '../db';
import { emitToAll } from './socket';
import { triggerNotifications } from './notifier';

// Map to keep track of active checking tasks (for fast manual triggers/throttling if needed)
const checkedTimes = new Map<string, number>();

export interface CheckResult {
  website_id: string;
  status_code: number | null;
  response_time: number;
  is_up: boolean;
  error_message: string | null;
  checked_at: Date;
}

export const performSingleCheck = async (website: any): Promise<CheckResult> => {
  const url = website.url;
  const timeoutMs = (website.timeout || 10) * 1000;
  const start = Date.now();
  
  let isUp = false;
  let statusCode: number | null = null;
  let errorMessage: string | null = null;

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

  // 1. Save check results to database
  const { rows: insertRows } = await query(
    `INSERT INTO check_results (website_id, status_code, response_time, is_up, error_message, checked_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [website.id, statusCode, responseTime, isUp, errorMessage, checkedAt]
  );

  const result = insertRows[0];

  // Update memory tracker
  checkedTimes.set(website.id, checkedAt.getTime());

  // 2. State change detection: Fetch the PREVIOUS check result
  const { rows: prevRows } = await query(
    `SELECT is_up FROM check_results 
     WHERE website_id = $1 AND id != $2 
     ORDER BY checked_at DESC 
     LIMIT 1`,
    [website.id, result.id]
  );

  const hadPreviousState = prevRows.length > 0;
  const wasUp = hadPreviousState ? prevRows[0].is_up : true; // Assume up if no history

  // Transition detection
  const stateChanged = !hadPreviousState ? !isUp : (wasUp !== isUp);

  if (stateChanged) {
    console.log(`[Monitor Service] Status transition: ${website.name} (${url}) is now ${isUp ? 'UP' : 'DOWN'}`);

    let alertId: string | null = null;

    if (!isUp) {
      // Trigger a new DOWN Alert
      const alertMsg = errorMessage || `Website is offline (Status code: ${statusCode})`;
      const { rows: alertRows } = await query(
        `INSERT INTO alerts (website_id, type, status, message, triggered_at)
         VALUES ($1, 'down', 'active', $2, $3)
         RETURNING id`,
        [website.id, alertMsg, checkedAt]
      );
      alertId = alertRows[0].id;

      // Dispatch alert notifications
      triggerNotifications(website, 'down', alertMsg).catch(err => {
        console.error('[Notifier] Error dispatching alerts:', err);
      });
    } else {
      // Resolve any active DOWN Alerts for this website
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

      // Dispatch resolve notification
      const resolveMsg = `Website is back online. Response time: ${responseTime}ms.`;
      triggerNotifications(website, 'resolved', resolveMsg).catch(err => {
        console.error('[Notifier] Error dispatching resolution alerts:', err);
      });
    }

    // Emit WebSocket status transition event
    emitToAll('website-status-changed', {
      websiteId: website.id,
      isUp,
      statusCode,
      responseTime,
      checkedAt,
      alertId,
      errorMessage
    });
  }

  // Emit generic check completed event (for live graphs)
  emitToAll('check-completed', {
    websiteId: website.id,
    isUp,
    statusCode,
    responseTime,
    checkedAt,
    errorMessage
  });

  return {
    website_id: website.id,
    status_code: statusCode,
    response_time: responseTime,
    is_up: isUp,
    error_message: errorMessage,
    checked_at: checkedAt
  };
};

// Scheduler interval ID
let monitorIntervalId: NodeJS.Timeout | null = null;

export const startMonitoring = () => {
  if (monitorIntervalId) {
    clearInterval(monitorIntervalId);
  }

  console.log('[Monitor Service] Initializing background check loop...');

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
            console.error(`[Monitor Service] Check failed for ${website.name}:`, error);
          });
        }
      }
    } catch (error) {
      console.error('[Monitor Service] Error in check scheduling tick:', error);
    }
  }, 10000); // Check schedule queue every 10s
};

export const stopMonitoring = () => {
  if (monitorIntervalId) {
    clearInterval(monitorIntervalId);
    monitorIntervalId = null;
    console.log('[Monitor Service] Background check loop stopped.');
  }
};
