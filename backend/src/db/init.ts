import { query } from './index';

export const initDb = async () => {
  console.log('[Database Init] Initializing database schema...');
  try {
    // 1. Enable pgcrypto for gen_random_uuid()
    await query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    // 2. Create Users Table
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin' NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // Self-healing migration for existing databases: Add public_sharing_enabled column
    await query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS public_sharing_enabled BOOLEAN DEFAULT FALSE NOT NULL;
    `);

    // 3. Create Websites Table
    await query(`
      CREATE TABLE IF NOT EXISTS websites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        url VARCHAR(2048) NOT NULL,
        check_interval INTEGER DEFAULT 60 NOT NULL,
        timeout INTEGER DEFAULT 10 NOT NULL,
        enabled BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // 4. Create Check Results Table
    await query(`
      CREATE TABLE IF NOT EXISTS check_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
        status_code INTEGER,
        response_time INTEGER,
        is_up BOOLEAN NOT NULL,
        error_message TEXT,
        checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        ssl_days_remaining INTEGER
      );
    `);

    // Self-healing migration for existing databases:
    await query(`
      ALTER TABLE check_results 
      ADD COLUMN IF NOT EXISTS ssl_days_remaining INTEGER;
    `);

    // Create Index on check_results (website_id, checked_at DESC) for quick history queries
    await query(`
      CREATE INDEX IF NOT EXISTS idx_check_results_website_checked 
      ON check_results(website_id, checked_at DESC);
    `);

    // 5. Create Alerts Table
    await query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL, -- 'down', 'slow', 'ssl_expiring'
        status VARCHAR(50) DEFAULT 'active' NOT NULL, -- 'active', 'resolved', 'acknowledged'
        message TEXT NOT NULL,
        triggered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        resolved_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // 6. Create Alert Channels Table
    await query(`
      CREATE TABLE IF NOT EXISTS alert_channels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL, -- 'email', 'slack', 'webhook'
        config JSONB DEFAULT '{}'::jsonb NOT NULL,
        enabled BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // 7. Create Audit Logs Table
    await query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(255) NOT NULL,
        resource VARCHAR(255) NOT NULL,
        old_value JSONB,
        new_value JSONB,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // 8. Create Global Settings Table
    await query(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB DEFAULT '{}'::jsonb NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // Seed default public status config if not exists
    await query(`
      INSERT INTO global_settings (key, value)
      VALUES ('public_status_enabled', 'false'::jsonb)
      ON CONFLICT (key) DO NOTHING;
    `);

    // 9. Create Production API Endpoints Table
    await query(`
      CREATE TABLE IF NOT EXISTS api_endpoints (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        service_name VARCHAR(100) DEFAULT 'core-api' NOT NULL,
        name VARCHAR(255) NOT NULL,
        path VARCHAR(2048) NOT NULL,
        http_method VARCHAR(10) DEFAULT 'GET' NOT NULL,
        headers JSONB DEFAULT '{}'::jsonb NOT NULL,
        body TEXT,
        expected_status_code INTEGER DEFAULT 200 NOT NULL,
        assertion_keyword TEXT,
        slo_availability NUMERIC(6,3) DEFAULT 99.900 NOT NULL, -- e.g. 99.9%
        slo_latency_p95_ms INTEGER DEFAULT 300 NOT NULL, -- e.g. 300ms
        current_deployment_version VARCHAR(50) DEFAULT 'v1.0.0' NOT NULL,
        previous_deployment_version VARCHAR(50),
        check_interval INTEGER DEFAULT 30 NOT NULL,
        timeout INTEGER DEFAULT 10 NOT NULL,
        enabled BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // 10. Create API Telemetry Events Table (Tracks every synthetic or real request for percentile & SLO calculation)
    await query(`
      CREATE TABLE IF NOT EXISTS api_telemetry_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        endpoint_id UUID NOT NULL REFERENCES api_endpoints(id) ON DELETE CASCADE,
        http_method VARCHAR(10) NOT NULL,
        status_code INTEGER NOT NULL,
        response_time_ms INTEGER NOT NULL,
        deployment_version VARCHAR(50) NOT NULL,
        is_error BOOLEAN NOT NULL DEFAULT FALSE,
        error_type VARCHAR(50), -- '5xx', '4xx', 'timeout', 'assertion_failed', 'latency_slo_breach'
        error_message TEXT,
        trace_id VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // Indexes on telemetry for ultra-fast percentile & window aggregation
    await query(`
      CREATE INDEX IF NOT EXISTS idx_api_telemetry_endpoint_time 
      ON api_telemetry_events(endpoint_id, created_at DESC);
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_api_telemetry_version_time 
      ON api_telemetry_events(deployment_version, created_at DESC);
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_api_telemetry_created_at 
      ON api_telemetry_events(created_at DESC);
    `);

    // 11. Create Deployment Baselines Table (for Per-Deployment Regression Detection)
    await query(`
      CREATE TABLE IF NOT EXISTS api_deployment_baselines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        endpoint_id UUID NOT NULL REFERENCES api_endpoints(id) ON DELETE CASCADE,
        deployment_version VARCHAR(50) NOT NULL,
        sample_count INTEGER DEFAULT 0 NOT NULL,
        p50_ms INTEGER DEFAULT 0 NOT NULL,
        p95_ms INTEGER DEFAULT 0 NOT NULL,
        p99_ms INTEGER DEFAULT 0 NOT NULL,
        error_rate_percent NUMERIC(5,2) DEFAULT 0.00 NOT NULL,
        is_regression BOOLEAN DEFAULT FALSE NOT NULL,
        regression_details JSONB DEFAULT '{}'::jsonb NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE (endpoint_id, deployment_version)
      );
    `);

    // 12. Migrate alerts table to support API endpoints, SLO burn-rates, and trace IDs
    await query(`
      ALTER TABLE alerts 
      ALTER COLUMN website_id DROP NOT NULL;
    `);
    await query(`
      ALTER TABLE alerts 
      ADD COLUMN IF NOT EXISTS endpoint_id UUID REFERENCES api_endpoints(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS burn_rate NUMERIC(8,2),
      ADD COLUMN IF NOT EXISTS window_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS trace_id VARCHAR(100),
      ADD COLUMN IF NOT EXISTS deployment_version VARCHAR(50);
    `);

    // Create Index on alerts(endpoint_id, triggered_at DESC)
    await query(`
      CREATE INDEX IF NOT EXISTS idx_alerts_endpoint_triggered 
      ON alerts(endpoint_id, triggered_at DESC);
    `);

    // 13. Auto-seed initial Production API endpoints if empty
    const { rows: epCount } = await query('SELECT COUNT(*)::int as count FROM api_endpoints');
    if (epCount[0].count === 0) {
      console.log('[Database Init] Auto-seeding initial production API endpoints...');
      await query(`
        INSERT INTO api_endpoints 
          (service_name, name, path, http_method, headers, body, expected_status_code, assertion_keyword, slo_availability, slo_latency_p95_ms, current_deployment_version, previous_deployment_version, check_interval, enabled)
        VALUES 
          ('auth-service', 'User Auth & Token Issuer', 'https://httpbin.org/status/200', 'POST', '{"Content-Type": "application/json"}'::jsonb, '{"grant_type": "client_credentials"}', 200, null, 99.99, 150, 'v2.4.0', 'v2.3.9', 30, true),
          ('payment-gateway', 'Payment Capture & Checkout API', 'https://httpbin.org/status/200', 'POST', '{"Authorization": "Bearer test_key_994"}'::jsonb, '{"amount": 4900, "currency": "USD"}', 200, null, 99.95, 350, 'v1.8.2', 'v1.8.1', 30, true),
          ('catalog-service', 'Product Catalog & Inventory API', 'https://httpbin.org/json', 'GET', '{"Accept": "application/json"}'::jsonb, null, 200, 'slideshow', 99.90, 220, 'v3.1.0', 'v3.0.9', 30, true),
          ('search-cluster', 'Product Fulltext Search API', 'https://httpbin.org/delay/0', 'GET', '{"X-Engine": "Opensearch"}'::jsonb, null, 200, null, 99.50, 180, 'v4.0.1', 'v3.9.8', 30, true)
        ON CONFLICT DO NOTHING;
      `);

      // Seed baseline telemetry for percentiles calculation
      const { rows: seededEndpoints } = await query('SELECT id, http_method, current_deployment_version, previous_deployment_version FROM api_endpoints');
      for (const ep of seededEndpoints) {
        const prevSamples = [42, 50, 58, 65, 72, 85, 98, 115, 135];
        for (const lat of prevSamples) {
          await query(
            `INSERT INTO api_telemetry_events 
               (endpoint_id, http_method, status_code, response_time_ms, deployment_version, is_error, trace_id, created_at)
             VALUES ($1, $2, 200, $3, $4, FALSE, $5, NOW() - INTERVAL '30 minutes')`,
            [ep.id, ep.http_method, lat, ep.previous_deployment_version, `00-${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}-01`]
          );
        }

        const currSamples = [45, 53, 62, 70, 80, 92, 105, 128, 155];
        for (const lat of currSamples) {
          await query(
            `INSERT INTO api_telemetry_events 
               (endpoint_id, http_method, status_code, response_time_ms, deployment_version, is_error, trace_id, created_at)
             VALUES ($1, $2, 200, $3, $4, FALSE, $5, NOW() - INTERVAL '3 minutes')`,
            [ep.id, ep.http_method, lat, ep.current_deployment_version, `00-${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}-01`]
          );
        }
      }
      console.log('[Database Init] Production API endpoints & telemetry baselines initialized.');
    }

    console.log('[Database Init] Database schema initialized successfully!');
  } catch (error) {
    console.error('[Database Init] Critical error initializing database:', error);
    throw error;
  }
};
