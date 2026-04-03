import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5433/triova_health' });
async function run() {
  const doctorId = 'a5b1362f-21d9-4095-a6f2-a288f20e9d65';
  const q = 'SELECT DISTINCT p.*, ts.urgency_level, ts.ai_summary, ts.chief_complaint FROM doctor_patient_assignments dpa JOIN patients p ON p.id = dpa.patient_id LEFT JOIN LATERAL (SELECT * FROM triage_sessions WHERE patient_id = p.id ORDER BY completed_at DESC NULLS LAST LIMIT 1) ts ON true WHERE dpa.doctor_id = $1';
  const res = await pool.query(q, [doctorId]);
  console.log('Final Result length:', res.rows.length);
  res.rows.forEach(r => console.log('Patient:', r.id, 'Urgency:', r.urgency_level));
  pool.end();
}
run();
