import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5433/triova_health' });

async function run() {
  const sql = `
    CREATE TABLE IF NOT EXISTS medications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      manufacturer TEXT,
      side_effects TEXT[],
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_google_tokens (
      user_id UUID PRIMARY KEY REFERENCES users(id),
      access_token TEXT,
      refresh_token TEXT,
      expires_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(sql);
    console.log('Tables created successfully');
  } catch (e: any) {
    console.error('Error creating tables:', e.message);
  } finally {
    await pool.end();
  }
}

run();
