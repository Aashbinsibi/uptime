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

    console.log('[Database Init] Database schema initialized successfully!');
  } catch (error) {
    console.error('[Database Init] Critical error initializing database:', error);
    throw error;
  }
};
