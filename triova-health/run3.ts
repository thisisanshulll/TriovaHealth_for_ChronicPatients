import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5433/triova_health' });
async function run() {
  await pool.query(
    CREATE TABLE IF NOT EXISTS user_google_tokens (
      user_id UUID PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  );
  console.log('Created user_google_tokens');
  pool.end();
}
run();
