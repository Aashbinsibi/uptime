import os from 'os';
import { query } from '../db';
import logger from './logger';

export interface EndpointMetricSnapshot {
  endpoint_id: string;
  window_minutes: number;
  total_requests: number;
  count_2xx: number;
  count_4xx: number;
  count_5xx: number;
  error_rate_5xx: number;
  error_rate_4xx: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  avg_ms: number;
  rps: number;
  sample_trace_id: string | null;
}

export interface BurnRateResult {
  window_minutes: number;
  observed_error_rate: number;
  allowed_error_rate: number;
  burn_rate: number;
  budget_consumed_percent: number;
}

export interface MultiWindowSloStatus {
  endpoint_id: string;
  endpoint_name: string;
  service_name: string;
  slo_availability: number;
  slo_latency_p95_ms: number;
  fast_burn: {
    is_firing: boolean;
    burn_rate_5m: number;
    burn_rate_1h: number;
    threshold: number;
  };
  slow_burn: {
    is_firing: boolean;
    burn_rate_30m: number;
    burn_rate_6h: number;
    threshold: number;
  };
  latency_slo_breach: {
    is_breached: boolean;
    current_p95_ms: number;
    slo_p95_ms: number;
  };
  error_rate_breach: {
    is_breached: boolean;
    current_5xx_rate: number;
    threshold: number;
  };
  error_budget_remaining_percent: number;
  projected_exhaustion_hours: number | null;
  latest_trace_id: string | null;
}

/**
 * Calculate accurate percentiles (P50, P95, P99) and error rates using PostgreSQL ordered-set aggregates
 */
export const calculateEndpointMetrics = async (
  endpointId: string,
  windowMinutes: number
): Promise<EndpointMetricSnapshot> => {
  const result = await query(
    `SELECT 
       COUNT(*)::integer AS total_requests,
       COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 400)::integer AS count_2xx,
       COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::integer AS count_4xx,
       COUNT(*) FILTER (WHERE status_code >= 500 OR is_error = true)::integer AS count_5xx,
       COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS p50_ms,
       COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS p95_ms,
       COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS p99_ms,
       COALESCE(AVG(response_time_ms), 0)::integer AS avg_ms,
       MAX(trace_id) AS sample_trace_id
     FROM api_telemetry_events
     WHERE endpoint_id = $1 
       AND created_at >= NOW() - ($2 || ' minutes')::interval`,
    [endpointId, windowMinutes]
  );

  const row = result.rows[0];
  const total = row.total_requests || 0;
  const count5xx = row.count_5xx || 0;
  const count4xx = row.count_4xx || 0;

  const errorRate5xx = total > 0 ? (count5xx / total) * 100 : 0;
  const errorRate4xx = total > 0 ? (count4xx / total) * 100 : 0;
  const rps = total > 0 ? parseFloat((total / (windowMinutes * 60)).toFixed(2)) : 0;

  return {
    endpoint_id: endpointId,
    window_minutes: windowMinutes,
    total_requests: total,
    count_2xx: row.count_2xx || 0,
    count_4xx: count4xx,
    count_5xx: count5xx,
    error_rate_5xx: parseFloat(errorRate5xx.toFixed(3)),
    error_rate_4xx: parseFloat(errorRate4xx.toFixed(3)),
    p50_ms: row.p50_ms || 0,
    p95_ms: row.p95_ms || 0,
    p99_ms: row.p99_ms || 0,
    avg_ms: row.avg_ms || 0,
    rps,
    sample_trace_id: row.sample_trace_id || null
  };
};

/**
 * Google SRE Multi-Window Multi-Burn-Rate Calculation
 * Burn Rate = Observed Error Rate / Allowed Error Rate (1 - SLO)
 */
export const calculateBurnRate = (
  observedErrorRateFraction: number,
  sloAvailabilityPercent: number,
  windowMinutes: number,
  periodDays: number = 30
): BurnRateResult => {
  const allowedErrorRate = (100 - sloAvailabilityPercent) / 100;
  const safeAllowed = allowedErrorRate <= 0 ? 0.0001 : allowedErrorRate;
  const burnRate = observedErrorRateFraction / safeAllowed;

  // Fraction of 30-day budget consumed during this specific window
  // Window fraction of period = windowMinutes / (periodDays * 24 * 60)
  const windowFraction = windowMinutes / (periodDays * 24 * 60);
  const budgetConsumedPercent = parseFloat((burnRate * windowFraction * 100).toFixed(3));

  return {
    window_minutes: windowMinutes,
    observed_error_rate: parseFloat((observedErrorRateFraction * 100).toFixed(4)),
    allowed_error_rate: parseFloat((safeAllowed * 100).toFixed(4)),
    burn_rate: parseFloat(burnRate.toFixed(2)),
    budget_consumed_percent: budgetConsumedPercent
  };
};

/**
 * Evaluate Google SRE Multi-Window Multi-Burn-Rate Alert Condition for an endpoint:
 * 1. Fast-burn (Critical On-call): Burn rate >= 14.4x over BOTH 5-min and 1-hour windows (consumes 2% in 1 hr)
 * 2. Slow-burn (Slack/Email): Burn rate >= 3.0x over BOTH 30-min and 6-hour windows (consumes 5% in 6 hrs)
 * 3. Latency SLO: P95 > target over 5-min window
 * 4. Error Rate: 5xx > 1.0% over 5-min window
 */
export const evaluateMultiWindowSlo = async (endpoint: any): Promise<MultiWindowSloStatus> => {
  const slo = parseFloat(endpoint.slo_availability) || 99.9;
  const p95Target = parseInt(endpoint.slo_latency_p95_ms) || 300;

  // Fetch metrics across required Google SRE windows: 5m, 30m, 60m (1h), 360m (6h), 43200m (30d)
  const [m5, m30, m60, m360, m30d] = await Promise.all([
    calculateEndpointMetrics(endpoint.id, 5),
    calculateEndpointMetrics(endpoint.id, 30),
    calculateEndpointMetrics(endpoint.id, 60),
    calculateEndpointMetrics(endpoint.id, 360),
    calculateEndpointMetrics(endpoint.id, 30 * 24 * 60)
  ]);

  const br5m = calculateBurnRate(m5.error_rate_5xx / 100, slo, 5);
  const br60m = calculateBurnRate(m60.error_rate_5xx / 100, slo, 60);
  const br30m = calculateBurnRate(m30.error_rate_5xx / 100, slo, 30);
  const br360m = calculateBurnRate(m360.error_rate_5xx / 100, slo, 360);

  // Fast-burn condition: Both 5m AND 1h windows have Burn Rate >= 14.4
  const fastBurnFiring = (m5.total_requests >= 5 && m60.total_requests >= 10) &&
    (br5m.burn_rate >= 14.4 && br60m.burn_rate >= 14.4);

  // Slow-burn condition: Both 30m AND 6h windows have Burn Rate >= 3.0
  const slowBurnFiring = (m30.total_requests >= 10 && m360.total_requests >= 20) &&
    (br30m.burn_rate >= 3.0 && br360m.burn_rate >= 3.0);

  // Latency SLO condition: P95 > target for 5m window
  const latencyBreached = m5.total_requests >= 3 && m5.p95_ms > p95Target;

  // 5xx Error rate condition: 5xx > 1.0% for 5m window
  const errorRateBreached = m5.total_requests >= 5 && m5.error_rate_5xx > 1.0;

  // 30-day budget consumption
  const br30d = calculateBurnRate(m30d.error_rate_5xx / 100, slo, 30 * 24 * 60);
  const budgetConsumed30d = Math.min(100, Math.max(0, br30d.budget_consumed_percent));
  const budgetRemaining = parseFloat((100 - budgetConsumed30d).toFixed(2));

  // Projected exhaustion: If current 1h burn rate > 1.0, hours until 100% budget consumed
  let projectedHours: number | null = null;
  if (br60m.burn_rate > 0.1) {
    // Total 30 days = 720 hours. Hours = (Remaining Budget / Total Budget) * (720 / BurnRate)
    projectedHours = parseFloat(((budgetRemaining / 100) * (720 / br60m.burn_rate)).toFixed(1));
  }

  const latestTraceId = m5.sample_trace_id || m60.sample_trace_id || null;

  return {
    endpoint_id: endpoint.id,
    endpoint_name: endpoint.name,
    service_name: endpoint.service_name || 'core-api',
    slo_availability: slo,
    slo_latency_p95_ms: p95Target,
    fast_burn: {
      is_firing: fastBurnFiring,
      burn_rate_5m: br5m.burn_rate,
      burn_rate_1h: br60m.burn_rate,
      threshold: 14.4
    },
    slow_burn: {
      is_firing: slowBurnFiring,
      burn_rate_30m: br30m.burn_rate,
      burn_rate_6h: br360m.burn_rate,
      threshold: 3.0
    },
    latency_slo_breach: {
      is_breached: latencyBreached,
      current_p95_ms: m5.p95_ms,
      slo_p95_ms: p95Target
    },
    error_rate_breach: {
      is_breached: errorRateBreached,
      current_5xx_rate: m5.error_rate_5xx,
      threshold: 1.0
    },
    error_budget_remaining_percent: budgetRemaining,
    projected_exhaustion_hours: projectedHours,
    latest_trace_id: latestTraceId
  };
};

/**
 * Per-Deployment Regression Detection:
 * Compares P50, P95, P99 of current deployment version vs. previous version.
 * Alerts if any percentile increases by > 20%.
 */
export const evaluateDeploymentRegression = async (endpoint: any) => {
  const currentVersion = endpoint.current_deployment_version;
  const prevVersion = endpoint.previous_deployment_version;

  if (!prevVersion || prevVersion === currentVersion) {
    return { has_regression: false, reason: 'No distinct previous deployment baseline' };
  }

  // Calculate stats for current version
  const { rows: currRows } = await query(
    `SELECT 
       COUNT(*)::integer AS sample_count,
       COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS p50_ms,
       COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS p95_ms,
       COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS p99_ms,
       COALESCE(COUNT(*) FILTER (WHERE status_code >= 500) * 100.0 / NULLIF(COUNT(*), 0), 0)::numeric(5,2) AS error_rate
     FROM api_telemetry_events
     WHERE endpoint_id = $1 AND deployment_version = $2`,
    [endpoint.id, currentVersion]
  );

  // Calculate stats for previous version
  const { rows: prevRows } = await query(
    `SELECT 
       COUNT(*)::integer AS sample_count,
       COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS p50_ms,
       COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS p95_ms,
       COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS p99_ms,
       COALESCE(COUNT(*) FILTER (WHERE status_code >= 500) * 100.0 / NULLIF(COUNT(*), 0), 0)::numeric(5,2) AS error_rate
     FROM api_telemetry_events
     WHERE endpoint_id = $1 AND deployment_version = $2`,
    [endpoint.id, prevVersion]
  );

  const curr = currRows[0];
  const prev = prevRows[0];

  if (!curr || curr.sample_count < 5 || !prev || prev.sample_count < 5) {
    return { has_regression: false, reason: 'Insufficient sample count for regression analysis' };
  }

  const p50Delta = prev.p50_ms > 0 ? ((curr.p50_ms - prev.p50_ms) / prev.p50_ms) * 100 : 0;
  const p95Delta = prev.p95_ms > 0 ? ((curr.p95_ms - prev.p95_ms) / prev.p95_ms) * 100 : 0;
  const p99Delta = prev.p99_ms > 0 ? ((curr.p99_ms - prev.p99_ms) / prev.p99_ms) * 100 : 0;

  // Rule: Alert when new deployment increases ANY percentile by > 20%
  const isRegression = p95Delta > 20 || p99Delta > 20 || p50Delta > 20;

  const regressionDetails = {
    endpoint_id: endpoint.id,
    endpoint_name: endpoint.name,
    current_version: currentVersion,
    previous_version: prevVersion,
    current_samples: curr.sample_count,
    previous_samples: prev.sample_count,
    p50: { current: curr.p50_ms, previous: prev.p50_ms, delta_percent: parseFloat(p50Delta.toFixed(1)) },
    p95: { current: curr.p95_ms, previous: prev.p95_ms, delta_percent: parseFloat(p95Delta.toFixed(1)) },
    p99: { current: curr.p99_ms, previous: prev.p99_ms, delta_percent: parseFloat(p99Delta.toFixed(1)) },
    error_rate: { current: parseFloat(curr.error_rate), previous: parseFloat(prev.error_rate) },
    regressed_metrics: [
      ...(p50Delta > 20 ? [`P50 (+${p50Delta.toFixed(1)}%)`] : []),
      ...(p95Delta > 20 ? [`P95 (+${p95Delta.toFixed(1)}%)`] : []),
      ...(p99Delta > 20 ? [`P99 (+${p99Delta.toFixed(1)}%)`] : [])
    ]
  };

  // Upsert baseline record
  await query(
    `INSERT INTO api_deployment_baselines 
       (endpoint_id, deployment_version, sample_count, p50_ms, p95_ms, p99_ms, error_rate_percent, is_regression, regression_details, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     ON CONFLICT (endpoint_id, deployment_version)
     DO UPDATE SET 
       sample_count = EXCLUDED.sample_count,
       p50_ms = EXCLUDED.p50_ms,
       p95_ms = EXCLUDED.p95_ms,
       p99_ms = EXCLUDED.p99_ms,
       error_rate_percent = EXCLUDED.error_rate_percent,
       is_regression = EXCLUDED.is_regression,
       regression_details = EXCLUDED.regression_details,
       updated_at = CURRENT_TIMESTAMP`,
    [
      endpoint.id,
      currentVersion,
      curr.sample_count,
      curr.p50_ms,
      curr.p95_ms,
      curr.p99_ms,
      curr.error_rate,
      isRegression,
      JSON.stringify(regressionDetails)
    ]
  );

  return {
    has_regression: isRegression,
    details: regressionDetails
  };
};

/**
 * Level 1: System Saturation & Golden Signals Overview
 */
export const getSystemSaturationAndSignals = async (serviceName: string = 'core-api') => {
  // 1. Host and Process Saturation Metrics
  const memUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMemPercent = parseFloat((((totalMem - freeMem) / totalMem) * 100).toFixed(1));
  const processHeapPercent = parseFloat(((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1));
  const loadAvg = os.loadavg();
  const cpuCount = os.cpus().length || 1;
  const cpuLoadPercent = parseFloat(((loadAvg[0] / cpuCount) * 100).toFixed(1));

  // 2. Aggregate Golden Signals across all endpoints in the last 5 minutes
  const { rows: signalRows } = await query(
    `SELECT 
       COUNT(*)::integer AS total_requests,
       COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::integer AS count_4xx,
       COUNT(*) FILTER (WHERE status_code >= 500 OR is_error = true)::integer AS count_5xx,
       COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS aggregate_p50_ms,
       COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS aggregate_p95_ms,
       COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms), 0)::integer AS aggregate_p99_ms,
       COALESCE(AVG(response_time_ms), 0)::integer AS aggregate_avg_ms
     FROM api_telemetry_events
     WHERE created_at >= NOW() - INTERVAL '5 minutes'`
  );

  const sig = signalRows[0];
  const totalReq = sig.total_requests || 0;
  const rate4xx = totalReq > 0 ? parseFloat(((sig.count_4xx / totalReq) * 100).toFixed(2)) : 0;
  const rate5xx = totalReq > 0 ? parseFloat(((sig.count_5xx / totalReq) * 100).toFixed(2)) : 0;
  const rps = totalReq > 0 ? parseFloat((totalReq / 300).toFixed(2)) : 0;

  // 3. Overall 30-day Error Budget Status across all endpoints
  const { rows: sloEndpoints } = await query(
    'SELECT id, name, slo_availability, slo_latency_p95_ms, current_deployment_version FROM api_endpoints WHERE enabled = TRUE'
  );

  let totalBudgetScore = 100;
  if (sloEndpoints.length > 0) {
    const sloStatuses = await Promise.all(sloEndpoints.map(e => evaluateMultiWindowSlo(e)));
    const avgRemaining = sloStatuses.reduce((acc, s) => acc + s.error_budget_remaining_percent, 0) / sloEndpoints.length;
    totalBudgetScore = parseFloat(avgRemaining.toFixed(2));
  }

  return {
    golden_signals: {
      latency: {
        p50_ms: sig.aggregate_p50_ms || 0,
        p95_ms: sig.aggregate_p95_ms || 0,
        p99_ms: sig.aggregate_p99_ms || 0,
        avg_ms: sig.aggregate_avg_ms || 0
      },
      errors: {
        rate_4xx: rate4xx,
        rate_5xx: rate5xx,
        count_4xx: sig.count_4xx || 0,
        count_5xx: sig.count_5xx || 0,
        status: rate5xx > 1.0 ? 'BREACHED' : 'HEALTHY'
      },
      traffic: {
        rps,
        requests_last_5m: totalReq
      },
      saturation: {
        cpu_load_percent: Math.min(100, Math.max(0, cpuLoadPercent)),
        system_memory_percent: usedMemPercent,
        process_heap_percent: processHeapPercent,
        status: (cpuLoadPercent > 80 || usedMemPercent > 80) ? 'HIGH_SATURATION (>80%)' : 'NORMAL'
      }
    },
    slo_overview: {
      monitored_endpoints_count: sloEndpoints.length,
      average_error_budget_remaining_percent: totalBudgetScore,
      service_status: totalBudgetScore < 10 ? 'EXHAUSTED' : totalBudgetScore < 50 ? 'DEGRADED' : 'HEALTHY'
    }
  };
};

/**
 * Pre-Deploy CI/CD Load Test Comparison (e.g. k6 hook)
 */
export const compareDeploymentsForCiCd = async (vNew: string, vPrev: string) => {
  const { rows: endpoints } = await query('SELECT * FROM api_endpoints WHERE enabled = TRUE');

  const comparisons = [];
  let hasBlockingRegression = false;

  for (const ep of endpoints) {
    const regressionRes = await evaluateDeploymentRegression({
      ...ep,
      current_deployment_version: vNew,
      previous_deployment_version: vPrev
    });

    if (regressionRes.has_regression) {
      hasBlockingRegression = true;
    }

    comparisons.push({
      endpoint_id: ep.id,
      endpoint_name: ep.name,
      path: ep.path,
      http_method: ep.http_method,
      has_regression: regressionRes.has_regression,
      details: regressionRes.details || null
    });
  }

  return {
    allow_rollout: !hasBlockingRegression,
    verdict: hasBlockingRegression ? 'BLOCKED_BY_SLO_REGRESSION' : 'PASSED_SLO_VERIFICATION',
    version_new: vNew,
    version_prev: vPrev,
    endpoints: comparisons
  };
};
