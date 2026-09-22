import axios, { AxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import { query } from '../db';
import { emitToAll } from './socket';
import { triggerNotifications } from './notifier';
import { evaluateMultiWindowSlo, evaluateDeploymentRegression } from './sloEngine';
import logger from './logger';

// Track execution timestamps for API monitors
const endpointCheckTimes = new Map<string, number>();

// In-memory alert suppression to avoid re-alerting every tick if condition is continuously firing
const activeSloAlertTracker = new Map<string, number>();

// Generate W3C-compatible trace ID for root cause distributed tracing
export const generateTraceId = (): string => {
  return `00-${crypto.randomBytes(16).toString('hex')}-${crypto.randomBytes(8).toString('hex')}-01`;
};

/**
 * Execute single API probe check
 */
export const performSingleApiCheck = async (endpoint: any) => {
  const method = (endpoint.http_method || 'GET').toUpperCase();
  const url = endpoint.path;
  const timeoutMs = (endpoint.timeout || 10) * 1000;
  const expectedStatus = parseInt(endpoint.expected_status_code) || 200;
  const assertionKeyword = endpoint.assertion_keyword;
  const version = endpoint.current_deployment_version || 'v1.0.0';
  const traceId = generateTraceId();

  let headers: Record<string, string> = {};
  if (endpoint.headers) {
    headers = typeof endpoint.headers === 'string' ? JSON.parse(endpoint.headers) : endpoint.headers;
  }

  const start = Date.now();
  let statusCode = 0;
  let isError = false;
  let errorType: string | null = null;
  let errorMessage: string | null = null;

  try {
    const requestHeaders: Record<string, string> = {
      'User-Agent': 'Antigravity-API-Probe/1.4 (Production SLO Monitor)',
      'X-Trace-Id': traceId,
      'traceparent': traceId,
      ...headers
    };

    let requestData: any = undefined;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && endpoint.body) {
      try {
        requestData = JSON.parse(endpoint.body);
        if (!requestHeaders['Content-Type']) {
          requestHeaders['Content-Type'] = 'application/json';
        }
      } catch {
        requestData = endpoint.body;
      }
    }

    const config: AxiosRequestConfig = {
      method,
      url,
      timeout: timeoutMs,
      headers: requestHeaders,
      data: requestData,
      validateStatus: () => true // Allow all HTTP response codes
    };

    const response = await axios(config);
    statusCode = response.status;

    // Check status code
    if (statusCode !== expectedStatus) {
      isError = true;
      errorType = statusCode >= 500 ? '5xx' : statusCode >= 400 ? '4xx' : 'status_mismatch';
      errorMessage = `HTTP Status mismatch: received ${statusCode}, expected ${expectedStatus}`;
    }

    // Check assertion keyword if status was expected
    if (!isError && assertionKeyword) {
      const responseBody = typeof response.data === 'object'
        ? JSON.stringify(response.data)
        : String(response.data);

      if (!responseBody.includes(assertionKeyword)) {
        isError = true;
        errorType = 'assertion_failed';
        errorMessage = `Assertion failed: body did not contain "${assertionKeyword}"`;
      }
    }
  } catch (err: any) {
    isError = true;
    errorType = err.code === 'ECONNABORTED' ? 'timeout' : 'network_error';
    statusCode = err.code === 'ECONNABORTED' ? 504 : 503;
    errorMessage = err.code === 'ECONNABORTED'
      ? `Probe timed out after ${endpoint.timeout || 10} seconds`
      : (err.message || 'Connection refused or DNS failure');
  }

  const durationMs = Date.now() - start;

  // Insert Telemetry event into database
  await query(
    `INSERT INTO api_telemetry_events 
       (endpoint_id, http_method, status_code, response_time_ms, deployment_version, is_error, error_type, error_message, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      endpoint.id,
      method,
      statusCode,
      durationMs,
      version,
      isError,
      errorType,
      errorMessage,
      traceId
    ]
  );

  endpointCheckTimes.set(endpoint.id, Date.now());

  // Real-time WebSocket telemetry emission
  emitToAll('api-telemetry-recorded', {
    endpoint_id: endpoint.id,
    endpoint_name: endpoint.name,
    http_method: method,
    status_code: statusCode,
    response_time_ms: durationMs,
    deployment_version: version,
    is_error: isError,
    error_message: errorMessage,
    trace_id: traceId,
    timestamp: new Date().toISOString()
  });

  // Evaluate SRE SLOs & Alert Conditions
  evaluateAndTriggerSloAlerts(endpoint, traceId, durationMs).catch(err => {
    logger.error(`[API Monitor] Error evaluating SLOs for ${endpoint.name}:`, { error: err.message });
  });

  return {
    endpoint_id: endpoint.id,
    status_code: statusCode,
    duration_ms: durationMs,
    is_error: isError,
    trace_id: traceId
  };
};

/**
 * Evaluates Google SRE multi-window multi-burn-rate, P95 SLO breaches, and deployment regressions
 */
const evaluateAndTriggerSloAlerts = async (endpoint: any, traceId: string, currentDurationMs: number) => {
  const sloStatus = await evaluateMultiWindowSlo(endpoint);

  // Broadcast live SLO status update to connected UI clients
  emitToAll('slo-status-updated', sloStatus);

  const now = Date.now();
  const alertCooldownMs = 15 * 60 * 1000; // 15 minutes cooldown per alert type

  // 1. FAST-BURN ALERT: 14.4x rate sustained over 5m & 1h (Critical / Page On-Call)
  if (sloStatus.fast_burn.is_firing) {
    const key = `${endpoint.id}:fast_burn`;
    const lastFired = activeSloAlertTracker.get(key);
    if (!lastFired || now - lastFired > alertCooldownMs) {
      activeSloAlertTracker.set(key, now);
      const msg = `🚨 CRITICAL FAST-BURN ALERT: ${endpoint.name} (${endpoint.path}) is consuming 30-day error budget at ${sloStatus.fast_burn.burn_rate_5m}x rate (threshold: 14.4x). Immediate outage imminent! Trace: ${traceId}`;
      logger.error(`[SRE SLO Engine] ${msg}`);

      await query(
        `INSERT INTO alerts (endpoint_id, type, status, message, burn_rate, window_minutes, trace_id, deployment_version)
         VALUES ($1, 'fast_burn', 'active', $2, $3, 5, $4, $5)`,
        [endpoint.id, msg, sloStatus.fast_burn.burn_rate_5m, traceId, endpoint.current_deployment_version]
      );

      triggerNotifications(
        { user_id: endpoint.user_id, name: endpoint.name, url: endpoint.path },
        'down',
        msg
      ).catch(() => {});
    }
  }

  // 2. SLOW-BURN ALERT: 3.0x rate sustained over 30m & 6h (Warning / Slack / Email)
  if (sloStatus.slow_burn.is_firing && !sloStatus.fast_burn.is_firing) {
    const key = `${endpoint.id}:slow_burn`;
    const lastFired = activeSloAlertTracker.get(key);
    if (!lastFired || now - lastFired > alertCooldownMs) {
      activeSloAlertTracker.set(key, now);
      const msg = `⚠️ SLOW-BURN BUDGET ALERT: ${endpoint.name} error budget burning at ${sloStatus.slow_burn.burn_rate_30m}x rate over 30m/6h window. Projected exhaustion in ${sloStatus.projected_exhaustion_hours || 'unknown'} hours. Trace: ${traceId}`;
      logger.warn(`[SRE SLO Engine] ${msg}`);

      await query(
        `INSERT INTO alerts (endpoint_id, type, status, message, burn_rate, window_minutes, trace_id, deployment_version)
         VALUES ($1, 'slow_burn', 'active', $2, $3, 30, $4, $5)`,
        [endpoint.id, msg, sloStatus.slow_burn.burn_rate_30m, traceId, endpoint.current_deployment_version]
      );

      triggerNotifications(
        { user_id: endpoint.user_id, name: endpoint.name, url: endpoint.path },
        'slow' as any,
        msg
      ).catch(() => {});
    }
  }

  // 3. LATENCY SLO BREACH: P95 > target
  if (sloStatus.latency_slo_breach.is_breached) {
    const key = `${endpoint.id}:latency_slo`;
    const lastFired = activeSloAlertTracker.get(key);
    if (!lastFired || now - lastFired > alertCooldownMs) {
      activeSloAlertTracker.set(key, now);
      const msg = `⏱️ LATENCY SLO BREACH: ${endpoint.name} P95 is ${sloStatus.latency_slo_breach.current_p95_ms}ms (SLO target: ${sloStatus.latency_slo_breach.slo_p95_ms}ms). Trace: ${traceId}`;
      logger.warn(`[SRE SLO Engine] ${msg}`);

      await query(
        `INSERT INTO alerts (endpoint_id, type, status, message, trace_id, deployment_version)
         VALUES ($1, 'slow', 'active', $2, $3, $4)`,
        [endpoint.id, msg, traceId, endpoint.current_deployment_version]
      );
    }
  }

  // 4. PER-DEPLOYMENT REGRESSION CHECK (> 20% latency increase vs. previous version)
  if (endpoint.previous_deployment_version) {
    const regressionCheck = await evaluateDeploymentRegression(endpoint);
    if (regressionCheck.has_regression && regressionCheck.details) {
      const key = `${endpoint.id}:regression:${endpoint.current_deployment_version}`;
      const lastFired = activeSloAlertTracker.get(key);
      if (!lastFired || now - lastFired > alertCooldownMs) {
        activeSloAlertTracker.set(key, now);
        const regressedList = regressionCheck.details.regressed_metrics.join(', ');
        const msg = `📉 DEPLOYMENT REGRESSION: ${endpoint.name} (${endpoint.current_deployment_version} vs ${endpoint.previous_deployment_version}) regressed by >20%: ${regressedList}. Trace: ${traceId}`;
        logger.error(`[SRE Regression Engine] ${msg}`);

        await query(
          `INSERT INTO alerts (endpoint_id, type, status, message, trace_id, deployment_version)
           VALUES ($1, 'regression', 'active', $2, $3, $4)`,
          [endpoint.id, msg, traceId, endpoint.current_deployment_version]
        );
      }
    }
  }
};

let apiMonitorIntervalId: NodeJS.Timeout | null = null;

/**
 * Start Background Production API Monitor Dispatcher
 */
export const startApiMonitoring = () => {
  if (apiMonitorIntervalId) {
    clearInterval(apiMonitorIntervalId);
  }

  logger.info('[API Monitor Service] Initializing production API & SLO check loop (10s scheduler)...');

  apiMonitorIntervalId = setInterval(async () => {
    try {
      const { rows: endpoints } = await query('SELECT * FROM api_endpoints WHERE enabled = TRUE');
      const now = Date.now();

      for (const endpoint of endpoints) {
        const lastChecked = endpointCheckTimes.get(endpoint.id);
        const intervalMs = (endpoint.check_interval || 30) * 1000;

        if (!lastChecked || now - lastChecked >= intervalMs) {
          endpointCheckTimes.set(endpoint.id, now);
          performSingleApiCheck(endpoint).catch(err => {
            logger.error(`[API Monitor Service] Probe error for ${endpoint.name}:`, { error: err.message });
          });
        }
      }
    } catch (error: any) {
      logger.error('[API Monitor Service] Error in check scheduling tick:', { error: error.message });
    }
  }, 10000);
};

export const stopApiMonitoring = () => {
  if (apiMonitorIntervalId) {
    clearInterval(apiMonitorIntervalId);
    apiMonitorIntervalId = null;
    logger.info('[API Monitor Service] Stopped check loop.');
  }
};
