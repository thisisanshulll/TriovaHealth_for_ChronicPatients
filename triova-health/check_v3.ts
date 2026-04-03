import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5433/triova_health' });
async function check() {
  const tables = [
    'users', 'patients', 'doctors', 'doctor_patient_assignments', 
    'appointments', 'triage_sessions', 'medications', 'patient_medications',
    'medical_documents', 'user_google_tokens', 'health_alerts'
  ];
  for (const t of tables) {
    try {
      const res = await pool.query(`SELECT count(*) FROM ${t}`);
      console.log(`Table ${t}: OK (${res.rows[0].count} rows)`);
    } catch (e: any) {
      console.log(`Table ${t}: ERROR - ${e.message}`);
    }
  }
}
check().catch(console.error).finally(() => pool.end());
