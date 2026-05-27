import { Pool, QueryResult } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Connection pooling best practice (max 20 connections)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[Database Pool] Unexpected error on idle client:', err);
});

export const query = async (text: string, params?: any[]): Promise<QueryResult> => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    // Verbose logging only in development, if needed
    if (process.env.NODE_ENV === 'development' && duration > 100) {
      console.log(`[Database Query] Executed query in ${duration}ms`, { text, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error('[Database Query] Error executing query:', { text, error });
    throw error;
  }
};

export default pool;
