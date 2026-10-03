import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth, requireWriter, AuthenticatedRequest } from '../middleware/auth';
import { 
  calculateEndpointMetrics, 
  evaluateMultiWindowSlo, 
  evaluateDeploymentRegression, 
  getSystemSaturationAndSignals,
  compareDeploymentsForCiCd
} from '../services/sloEngine';
import { performSingleApiCheck, generateTraceId } from '../services/apiMonitor';
import logger from '../services/logger';

const router = Router();

const EndpointSchema = z.object({
  service_name: z.string().min(1).default('core-api'),
  name: z.string().min(1, 'Endpoint name is required').max(255),
  path: z.string().url('Path must be a valid URL (http/https)'),
  http_method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  headers: z.record(z.string()).default({}),
  body: z.string().optional().nullable(),
  expected_status_code: z.number().int().min(100).max(599).default(200),
  assertion_keyword: z.string().optional().nullable(),
  slo_availability: z.number().min(90).max(100).default(99.9),
  slo_latency_p95_ms: z.number().int().min(1).max(30000).default(300),
  current_deployment_version: z.string().min(1).default('v1.0.0'),
  previous_deployment_version: z.string().optional().nullable(),
  check_interval: z.number().int().min(5).max(3600).default(30),
  timeout: z.number().int().min(1).max(60).default(10),
  enabled: z.boolean().default(true)
});

const EndpointUpdateSchema = EndpointSchema.partial();

/**
 * 1. LEVEL 1: System Saturation & Golden Signals Overview
 */
router.get('/overview', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await getSystemSaturationAndSignals();
    return res.json({
      success: true,
      data
    });
  } catch (error: any) {
    logger.error('[API Overview] Failed to fetch golden signals:', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 2. LEVEL 2: List All Monitored API Endpoints (with P50/P95/P99 & Regression Flags)
 */
router.get('/endpoints', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { rows: endpoints } = await query(
      `SELECT e.*, 
              b.p50_ms as baseline_p50,
              b.p95_ms as baseline_p95,
              b.p99_ms as baseline_p99,
              b.is_regression as baseline_is_regression,
              b.regression_details
       FROM api_endpoints e
       LEFT JOIN api_deployment_baselines b 
         ON e.id = b.endpoint_id AND e.current_deployment_version = b.deployment_version
       WHERE e.user_id = $1 OR e.user_id IS NULL
       ORDER BY e.created_at DESC`,
      [userId]
    );

    // Compute live 5m metric snapshots and SLO status for each endpoint
    const enriched = await Promise.all(
      endpoints.map(async (ep) => {
        const metrics5m = await calculateEndpointMetrics(ep.id, 5);
        const metrics1h = await calculateEndpointMetrics(ep.id, 60);
        const sloStatus = await evaluateMultiWindowSlo(ep);

        return {
          ...ep,
          live_metrics_5m: metrics5m,
          live_metrics_1h: metrics1h,
          slo_status: sloStatus
        };
      })
    );

    return res.json({
      success: true,
      data: enriched
    });
  } catch (error: any) {
    logger.error('[Endpoints List] Error:', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 3. LEVEL 2 & 3: Single Endpoint Detail (Latency Distribution & Trace Links)
 */
router.get('/endpoints/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rows: epRows } = await query('SELECT * FROM api_endpoints WHERE id = $1', [id]);

    if (epRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Endpoint not found' });
    }

    const endpoint = epRows[0];

    // Windows for historical latency curves: 5m, 1h, 24h, 7d
    const [m5m, m1h, m24h, m7d] = await Promise.all([
      calculateEndpointMetrics(id, 5),
      calculateEndpointMetrics(id, 60),
      calculateEndpointMetrics(id, 1440),
      calculateEndpointMetrics(id, 10080)
    ]);

    // Fetch recent 50 telemetry samples for latency distribution chart & trace inspection
    const { rows: telemetrySamples } = await query(
      `SELECT id, http_method, status_code, response_time_ms, deployment_version, is_error, error_type, error_message, trace_id, created_at
       FROM api_telemetry_events
       WHERE endpoint_id = $1
       ORDER BY created_at DESC
       LIMIT 60`,
      [id]
    );

    // Fetch deployment baselines for regression history
    const { rows: baselines } = await query(
      `SELECT deployment_version, sample_count, p50_ms, p95_ms, p99_ms, error_rate_percent, is_regression, regression_details, updated_at
       FROM api_deployment_baselines
       WHERE endpoint_id = $1
       ORDER BY updated_at DESC`,
      [id]
    );

    // Full multi-window burn rate evaluation
    const sloStatus = await evaluateMultiWindowSlo(endpoint);

    return res.json({
      success: true,
      data: {
        endpoint,
        slo_status: sloStatus,
        timeframes: {
          '5m': m5m,
          '1h': m1h,
          '24h': m24h,
          '7d': m7d
        },
        recent_telemetry: telemetrySamples.reverse(),
        deployment_baselines: baselines
      }
    });
  } catch (error: any) {
    logger.error('[Endpoint Detail] Error:', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 4. Create New Monitored API Endpoint
 */
router.post('/endpoints', requireWriter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const validated = EndpointSchema.parse(req.body);

    const { rows } = await query(
      `INSERT INTO api_endpoints 
         (user_id, service_name, name, path, http_method, headers, body, expected_status_code, assertion_keyword, slo_availability, slo_latency_p95_ms, current_deployment_version, previous_deployment_version, check_interval, timeout, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        userId,
        validated.service_name,
        validated.name,
        validated.path,
        validated.http_method,
        JSON.stringify(validated.headers),
        validated.body,
        validated.expected_status_code,
        validated.assertion_keyword,
        validated.slo_availability,
        validated.slo_latency_p95_ms,
        validated.current_deployment_version,
        validated.previous_deployment_version || null,
        validated.check_interval,
        validated.timeout,
        validated.enabled
      ]
    );

    const newEndpoint = rows[0];

    // Trigger initial check asynchronously
    performSingleApiCheck(newEndpoint).catch(() => {});

    return res.status(201).json({
      success: true,
      data: newEndpoint
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    logger.error('[Endpoint Create] Error:', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 5. Update Monitored API Endpoint (Handles deployment version bumps for regression checks)
 */
router.put('/endpoints/:id', requireWriter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const validated = EndpointUpdateSchema.parse(req.body);

    const { rows: existingRows } = await query('SELECT * FROM api_endpoints WHERE id = $1', [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Endpoint not found' });
    }

    const current = existingRows[0];

    // If new deployment version is provided without specifying previous, auto-shift current to previous!
    let prevVersion = validated.previous_deployment_version !== undefined 
      ? validated.previous_deployment_version 
      : current.previous_deployment_version;

    if (validated.current_deployment_version && validated.current_deployment_version !== current.current_deployment_version) {
      prevVersion = current.current_deployment_version;
    }

    const { rows: updatedRows } = await query(
      `UPDATE api_endpoints 
       SET service_name = COALESCE($1, service_name),
           name = COALESCE($2, name),
           path = COALESCE($3, path),
           http_method = COALESCE($4, http_method),
           headers = COALESCE($5, headers),
           body = COALESCE($6, body),
           expected_status_code = COALESCE($7, expected_status_code),
           assertion_keyword = COALESCE($8, assertion_keyword),
           slo_availability = COALESCE($9, slo_availability),
           slo_latency_p95_ms = COALESCE($10, slo_latency_p95_ms),
           current_deployment_version = COALESCE($11, current_deployment_version),
           previous_deployment_version = $12,
           check_interval = COALESCE($13, check_interval),
           timeout = COALESCE($14, timeout),
           enabled = COALESCE($15, enabled),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $16
       RETURNING *`,
      [
        validated.service_name,
        validated.name,
        validated.path,
        validated.http_method,
        validated.headers ? JSON.stringify(validated.headers) : null,
        validated.body,
        validated.expected_status_code,
        validated.assertion_keyword,
        validated.slo_availability,
        validated.slo_latency_p95_ms,
        validated.current_deployment_version,
        prevVersion,
        validated.check_interval,
        validated.timeout,
        validated.enabled,
        id
      ]
    );

    return res.json({
      success: true,
      data: updatedRows[0]
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 6. Delete Monitored API Endpoint
 */
router.delete('/endpoints/:id', requireWriter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM api_endpoints WHERE id = $1', [id]);
    return res.json({ success: true, message: 'Endpoint deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 7. Manual Probe Execution
 */
router.post('/endpoints/:id/check', requireWriter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rows } = await query('SELECT * FROM api_endpoints WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Endpoint not found' });

    const result = await performSingleApiCheck(rows[0]);
    return res.json({
      success: true,
      message: 'Probe check completed',
      data: result
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 8. LEVEL 3: SRE Multi-Window Burn Rates & Error Budget Matrix
 */
router.get('/slo-budget', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { rows: endpoints } = await query('SELECT * FROM api_endpoints WHERE enabled = TRUE ORDER BY name ASC');
    const evaluations = await Promise.all(endpoints.map(ep => evaluateMultiWindowSlo(ep)));

    // Active SLO alerts
    const { rows: activeAlerts } = await query(
      `SELECT a.*, e.name as endpoint_name, e.path as endpoint_path
       FROM alerts a
       INNER JOIN api_endpoints e ON a.endpoint_id = e.id
       WHERE a.status = 'active'
       ORDER BY a.triggered_at DESC`
    );

    return res.json({
      success: true,
      data: {
        endpoints: evaluations,
        active_alerts: activeAlerts
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 9. Pre-Deployment CI/CD Comparison (e.g. k6 load test validation)
 */
router.get('/deployments/compare', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vNew = req.query.v_new as string;
    const vPrev = req.query.v_prev as string;

    if (!vNew || !vPrev) {
      return res.status(400).json({
        success: false,
        error: 'Query parameters v_new and v_prev are required (e.g. ?v_new=v1.2.0&v_prev=v1.1.0)'
      });
    }

    const comparison = await compareDeploymentsForCiCd(vNew, vPrev);
    return res.json({
      success: true,
      data: comparison
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 10. External Telemetry Ingestion (for real production traffic or k6 runners)
 */
router.post('/telemetry/ingest', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schema = z.object({
      endpoint_id: z.string().uuid(),
      http_method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']),
      status_code: z.number().int().min(100).max(599),
      response_time_ms: z.number().int().min(0),
      deployment_version: z.string().default('v1.0.0'),
      is_error: z.boolean().optional(),
      error_type: z.string().optional(),
      error_message: z.string().optional(),
      trace_id: z.string().optional()
    });

    const body = req.body;
    const items = Array.isArray(body) ? body : [body];
    const traceIdFallback = generateTraceId();

    for (const item of items) {
      const v = schema.parse(item);
      const isErr = v.is_error !== undefined ? v.is_error : (v.status_code >= 500);

      await query(
        `INSERT INTO api_telemetry_events 
           (endpoint_id, http_method, status_code, response_time_ms, deployment_version, is_error, error_type, error_message, trace_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          v.endpoint_id,
          v.http_method,
          v.status_code,
          v.response_time_ms,
          v.deployment_version,
          isErr,
          v.error_type || (v.status_code >= 500 ? '5xx' : v.status_code >= 400 ? '4xx' : null),
          v.error_message || null,
          v.trace_id || traceIdFallback
        ]
      );
    }

    return res.json({
      success: true,
      message: `Ingested ${items.length} telemetry event(s) successfully`
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * 11. Demo / Seed Helper: Instantly populates realistic production API endpoints with sample telemetry
 */
router.post('/seed', requireWriter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    // Check if already seeded
    const { rows: existing } = await query('SELECT COUNT(*)::int as count FROM api_endpoints');
    if (existing[0].count > 0) {
      return res.json({ success: true, message: 'Endpoints already seeded', count: existing[0].count });
    }

    const demoEndpoints = [
      {
        service_name: 'auth-service',
        name: 'User Authentication & Token Issuer',
        path: 'https://httpbin.org/status/200',
        http_method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials' }),
        expected_status_code: 200,
        slo_availability: 99.99,
        slo_latency_p95_ms: 150,
        current_deployment_version: 'v2.4.0',
        previous_deployment_version: 'v2.3.9',
        check_interval: 20
      },
      {
        service_name: 'payment-gateway',
        name: 'Checkout & Payment Capture API',
        path: 'https://httpbin.org/status/200',
        http_method: 'POST',
        headers: { 'Authorization': 'Bearer test_sec_key_994' },
        body: JSON.stringify({ amount: 4900, currency: 'USD' }),
        expected_status_code: 200,
        slo_availability: 99.95,
        slo_latency_p95_ms: 350,
        current_deployment_version: 'v1.8.2',
        previous_deployment_version: 'v1.8.1',
        check_interval: 20
      },
      {
        service_name: 'inventory-api',
        name: 'Catalog & Stock Query',
        path: 'https://httpbin.org/json',
        http_method: 'GET',
        headers: { 'Accept': 'application/json' },
        expected_status_code: 200,
        assertion_keyword: 'slideshow',
        slo_availability: 99.90,
        slo_latency_p95_ms: 220,
        current_deployment_version: 'v3.1.0',
        previous_deployment_version: 'v3.0.9',
        check_interval: 30
      },
      {
        service_name: 'search-cluster',
        name: 'Product Fulltext Search',
        path: 'https://httpbin.org/delay/0',
        http_method: 'GET',
        headers: { 'X-Search-Engine': 'Opensearch' },
        expected_status_code: 200,
        slo_availability: 99.50,
        slo_latency_p95_ms: 180,
        current_deployment_version: 'v4.0.1',
        previous_deployment_version: 'v3.9.8',
        check_interval: 25
      }
    ];

    for (const ep of demoEndpoints) {
      const { rows: inserted } = await query(
        `INSERT INTO api_endpoints 
           (user_id, service_name, name, path, http_method, headers, body, expected_status_code, assertion_keyword, slo_availability, slo_latency_p95_ms, current_deployment_version, previous_deployment_version, check_interval, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE)
         RETURNING id`,
        [
          userId,
          ep.service_name,
          ep.name,
          ep.path,
          ep.http_method,
          JSON.stringify(ep.headers),
          ep.body || null,
          ep.expected_status_code,
          ep.assertion_keyword || null,
          ep.slo_availability,
          ep.slo_latency_p95_ms,
          ep.current_deployment_version,
          ep.previous_deployment_version,
          ep.check_interval
        ]
      );

      const epId = inserted[0].id;

      // Seed 25 realistic telemetry records across previous & current versions
      // so percentiles (P50, P95, P99) and regression calculations render instantly
      const latenciesPrev = [45, 52, 60, 68, 75, 82, 95, 110, 140, 180];
      for (const lat of latenciesPrev) {
        await query(
          `INSERT INTO api_telemetry_events 
             (endpoint_id, http_method, status_code, response_time_ms, deployment_version, is_error, trace_id, created_at)
           VALUES ($1, $2, 200, $3, $4, FALSE, $5, NOW() - INTERVAL '40 minutes')`,
          [epId, ep.http_method, lat, ep.previous_deployment_version, generateTraceId()]
        );
      }

      const latenciesCurr = [48, 55, 62, 70, 78, 85, 98, 120, 160, 210];
      for (const lat of latenciesCurr) {
        await query(
          `INSERT INTO api_telemetry_events 
             (endpoint_id, http_method, status_code, response_time_ms, deployment_version, is_error, trace_id, created_at)
           VALUES ($1, $2, 200, $3, $4, FALSE, $5, NOW() - INTERVAL '5 minutes')`,
          [epId, ep.http_method, lat, ep.current_deployment_version, generateTraceId()]
        );
      }
    }

    return res.json({
      success: true,
      message: 'Successfully seeded 4 production API endpoints with telemetry baselines.'
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
