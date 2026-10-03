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

    // 14. Create Servers Table for Gravity / Uptime Agent Monitoring
    await query(`
      CREATE TABLE IF NOT EXISTS servers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        hostname VARCHAR(255),
        ip_address VARCHAR(45),
        os_name VARCHAR(100) DEFAULT 'Ubuntu',
        os_version VARCHAR(100) DEFAULT '22.04 LTS',
        kernel_version VARCHAR(100),
        architecture VARCHAR(50) DEFAULT 'amd64',
        cpu_cores INTEGER DEFAULT 4,
        cpu_model VARCHAR(255) DEFAULT 'AMD EPYC 7763 64-Core Processor',
        total_memory_bytes BIGINT DEFAULT 8589934592,
        total_disk_bytes BIGINT DEFAULT 107374182400,
        agent_version VARCHAR(50) DEFAULT '0.1',
        agent_status VARCHAR(50) DEFAULT 'ONLINE', -- 'ONLINE', 'OFFLINE', 'DEGRADED', 'INSTALLING', 'UPGRADING'
        heartbeat_interval_seconds INTEGER DEFAULT 30,
        last_heartbeat_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        docker_enabled BOOLEAN DEFAULT TRUE,
        api_token VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // 15. Create Server Metrics Table (Timeseries host & container telemetry)
    await query(`
      CREATE TABLE IF NOT EXISTS server_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        cpu_usage_percent NUMERIC(5,2) DEFAULT 0.00,
        load_1m NUMERIC(5,2) DEFAULT 0.00,
        load_5m NUMERIC(5,2) DEFAULT 0.00,
        load_15m NUMERIC(5,2) DEFAULT 0.00,
        memory_used_bytes BIGINT DEFAULT 0,
        memory_total_bytes BIGINT DEFAULT 0,
        memory_usage_percent NUMERIC(5,2) DEFAULT 0.00,
        swap_used_bytes BIGINT DEFAULT 0,
        swap_total_bytes BIGINT DEFAULT 0,
        disk_used_bytes BIGINT DEFAULT 0,
        disk_total_bytes BIGINT DEFAULT 0,
        disk_usage_percent NUMERIC(5,2) DEFAULT 0.00,
        network_rx_bytes BIGINT DEFAULT 0,
        network_tx_bytes BIGINT DEFAULT 0,
        processes_count INTEGER DEFAULT 0,
        top_processes JSONB DEFAULT '[]'::jsonb,
        docker_stats JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // Indexes for high performance metric aggregations
    await query(`
      CREATE INDEX IF NOT EXISTS idx_server_metrics_server_created 
      ON server_metrics(server_id, created_at DESC);
    `);

    // 16. Create Agent Install Tokens Table
    await query(`
      CREATE TABLE IF NOT EXISTS agent_install_tokens (
        token VARCHAR(255) PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        server_name VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used BOOLEAN DEFAULT FALSE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // 17. Auto-seed initial servers and metrics if empty
    const { rows: srvCount } = await query('SELECT COUNT(*)::int as count FROM servers');
    if (srvCount[0].count === 0) {
      console.log('[Database Init] Auto-seeding initial production servers...');
      const seedServers = [
        {
          name: 'server-prod-01 (API Gateway)',
          hostname: 'srv-prod-01',
          ip_address: '172.31.28.14',
          os_name: 'Ubuntu',
          os_version: '24.04 LTS',
          kernel_version: '6.8.0-31-generic',
          architecture: 'amd64',
          cpu_cores: 4,
          cpu_model: 'Intel Xeon Platinum 8375C',
          total_memory_bytes: 17179869184, // 16 GB
          total_disk_bytes: 268435456000,  // 250 GB
          agent_version: '0.1',
          agent_status: 'ONLINE',
          docker_enabled: true,
          api_token: 'upt_tok_srv_prod_01_gateway_11a9'
        },
        {
          name: 'server-staging (App & Cache)',
          hostname: 'srv-stage-app',
          ip_address: '192.168.1.88',
          os_name: 'Debian',
          os_version: '12 Bookworm',
          kernel_version: '6.1.0-21-amd64',
          architecture: 'amd64',
          cpu_cores: 2,
          cpu_model: 'Intel Core Processor (Broadwell)',
          total_memory_bytes: 8589934592, // 8 GB
          total_disk_bytes: 107374182400, // 100 GB
          agent_version: '0.1',
          agent_status: 'DEGRADED',
          docker_enabled: false,
          api_token: 'upt_tok_stage_app_deg_992'
        }
      ];

      for (const s of seedServers) {
        const { rows: inserted } = await query(
          `INSERT INTO servers 
             (name, hostname, ip_address, os_name, os_version, kernel_version, architecture, cpu_cores, cpu_model, total_memory_bytes, total_disk_bytes, agent_version, agent_status, docker_enabled, api_token)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING id`,
          [s.name, s.hostname, s.ip_address, s.os_name, s.os_version, s.kernel_version, s.architecture, s.cpu_cores, s.cpu_model, s.total_memory_bytes, s.total_disk_bytes, s.agent_version, s.agent_status, s.docker_enabled, s.api_token]
        );

        const serverId = inserted[0].id;

        // Seed 10 recent historical telemetry points
        for (let i = 9; i >= 0; i--) {
          const cpuVal = s.agent_status === 'DEGRADED' ? 84.5 + Math.random() * 8 : 18.2 + Math.random() * 12;
          const memVal = s.agent_status === 'DEGRADED' ? 88.0 : 42.5 + Math.random() * 5;
          const memUsed = Math.floor(s.total_memory_bytes * (memVal / 100));
          const diskUsed = Math.floor(s.total_disk_bytes * 0.48);

          await query(
            `INSERT INTO server_metrics 
               (server_id, cpu_usage_percent, load_1m, load_5m, load_15m, memory_used_bytes, memory_total_bytes, memory_usage_percent, swap_used_bytes, swap_total_bytes, disk_used_bytes, disk_total_bytes, disk_usage_percent, network_rx_bytes, network_tx_bytes, processes_count, top_processes, docker_stats, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW() - ($19 || ' minutes')::interval)`,
            [
              serverId,
              cpuVal.toFixed(2),
              (cpuVal / 25).toFixed(2),
              (cpuVal / 30).toFixed(2),
              (cpuVal / 35).toFixed(2),
              memUsed,
              s.total_memory_bytes,
              memVal.toFixed(2),
              104857600, // 100MB swap
              2147483648, // 2GB swap
              diskUsed,
              s.total_disk_bytes,
              48.0,
              14829104 + i * 82010,
              29401923 + i * 192040,
              142,
              JSON.stringify([
                { pid: 1420, name: 'mysqld', cpu: 12.4, mem: 24.1, user: 'mysql' },
                { pid: 2108, name: 'dockerd', cpu: 3.8, mem: 4.2, user: 'root' },
                { pid: 3410, name: 'nginx', cpu: 2.1, mem: 1.8, user: 'www-data' },
                { pid: 8812, name: 'gravity-agent', cpu: 0.6, mem: 0.8, user: 'gravity' },
                { pid: 914, name: 'redis-server', cpu: 0.4, mem: 2.2, user: 'redis' }
              ]),
              JSON.stringify({
                active_containers: s.docker_enabled ? 4 : 0,
                total_containers: s.docker_enabled ? 5 : 0,
                containers: s.docker_enabled ? [
                  { id: 'c90a1f81b', name: 'mysql-primary', image: 'mysql:8.0', state: 'running', cpu_percent: 11.2, memory_usage_mb: 1840, restart_count: 0 },
                  { id: 'b71d44ea0', name: 'redis-cache', image: 'redis:7-alpine', state: 'running', cpu_percent: 0.4, memory_usage_mb: 148, restart_count: 0 },
                  { id: 'f820ae391', name: 'api-worker', image: 'app/worker:v2', state: 'running', cpu_percent: 2.9, memory_usage_mb: 320, restart_count: 1 },
                  { id: '11e40c883', name: 'nginx-proxy', image: 'nginx:alpine', state: 'running', cpu_percent: 1.1, memory_usage_mb: 64, restart_count: 0 }
                ] : []
              }),
              i * 3
            ]
          );
        }
      }
      console.log('[Database Init] Production servers & initial telemetry seeded.');
    }

    console.log('[Database Init] Database schema initialized successfully!');
  } catch (error) {
    console.error('[Database Init] Critical error initializing database:', error);
    throw error;
  }
};
