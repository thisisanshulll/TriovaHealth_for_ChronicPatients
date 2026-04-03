import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5433/triova_health' });
async function check() {
  const doctorId = 'a5b1362f-21d9-4095-a6f2-a288f20e9d65';
  const query = `
     SELECT DISTINCT p.id, p.first_name, p.last_name, ts.urgency_level
     FROM doctor_patient_assignments dpa
     JOIN patients p ON p.id = dpa.patient_id
     LEFT JOIN LATERAL (
       SELECT urgency_level FROM triage_sessions 
       WHERE patient_id = p.id 
       ORDER BY completed_at DESC NULLS LAST LIMIT 1
     ) ts ON true
     WHERE dpa.doctor_id = $1
  `;
  const res = await pool.query(query, [doctorId]);
  console.log('Total Results:', res.rows.length);
  res.rows.forEach(r => console.log(`Patient: ${r.first_name} ${r.last_name}, Urgency: ${r.urgency_level}`));
  pool.end();
}
check();
