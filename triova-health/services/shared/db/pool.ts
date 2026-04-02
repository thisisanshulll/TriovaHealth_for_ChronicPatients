import pg from 'pg';
import path from 'path';
import dotenv from 'dotenv';

const { Pool } = pg;

// Load env from common workspace locations before reading DATABASE_URL.
for (const envPath of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '../../../.env'),
]) {
  dotenv.config({ path: envPath, override: false });
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV !== 'test') {
  console.warn('[triova] DATABASE_URL is not set');
}

export const pool = new Pool({
  connectionString: connectionString || 'postgresql://postgres:postgres@localhost:5433/triova_health',
  max: 20,
  idleTimeoutMillis: 30000,
});

export async function query<T = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.LOG_LEVEL === 'debug') {
    console.debug('executed query', { text: text.slice(0, 120), duration, rows: res.rowCount });
  }
  return res;
}
