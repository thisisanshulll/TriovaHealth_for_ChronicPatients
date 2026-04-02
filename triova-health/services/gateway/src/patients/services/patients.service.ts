import { pool } from '@triova/shared';

export async function getPatient(id: string) {
  const p = await pool.query(`SELECT * FROM patients WHERE id = $1`, [id]);
  if (!p.rows[0]) throw Object.assign(new Error('Not found'), { status: 404 });
  const allergies = await pool.query(`SELECT * FROM patient_allergies WHERE patient_id = $1`, [id]);
  const chronic = await pool.query(`SELECT * FROM patient_chronic_conditions WHERE patient_id = $1`, [id]);
  const meds = await pool.query(`SELECT * FROM patient_medications WHERE patient_id = $1 AND is_active = true`, [id]);
  return { patient: p.rows[0], allergies: allergies.rows, chronic_conditions: chronic.rows, active_medications: meds.rows };
}

export async function patchPatient(id: string, body: Record<string, unknown>) {
  const fields = ['first_name', 'last_name', 'phone', 'height_cm', 'weight_kg', 'preferred_language', 'emergency_contact_name', 'emergency_contact_phone'];
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const f of fields) {
    if (body[f] !== undefined) {
      sets.push(`${f} = $${i++}`);
      vals.push(body[f]);
    }
  }
  if (!sets.length) return (await pool.query(`SELECT * FROM patients WHERE id = $1`, [id])).rows[0];
  vals.push(id);
  const r = await pool.query(`UPDATE patients SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  return r.rows[0];
}

export async function addAllergy(patientId: string, body: { allergen: string; severity?: string; reaction_description?: string }) {
  const r = await pool.query(
    `INSERT INTO patient_allergies (patient_id, allergen, severity, reaction_description) VALUES ($1,$2,$3,$4) RETURNING *`,
    [patientId, body.allergen, body.severity || null, body.reaction_description || null]
  );
  return r.rows[0];
}

export async function deleteAllergy(patientId: string, allergyId: string) {
  await pool.query(`DELETE FROM patient_allergies WHERE id = $1 AND patient_id = $2`, [allergyId, patientId]);
}

export async function addCondition(patientId: string, body: { condition_name: string; diagnosed_date?: string; notes?: string }) {
  const r = await pool.query(
    `INSERT INTO patient_chronic_conditions (patient_id, condition_name, diagnosed_date, notes) VALUES ($1,$2,$3::date,$4) RETURNING *`,
    [patientId, body.condition_name, body.diagnosed_date || null, body.notes || null]
  );
  return r.rows[0];
}

export async function deleteCondition(_patientId: string, conditionId: string) {
  await pool.query(`DELETE FROM patient_chronic_conditions WHERE id = $1`, [conditionId]);
}

export async function addMedication(
  patientId: string,
  body: { medication_name: string; dosage?: string; frequency?: string; timing_instructions?: string; start_date: string; end_date?: string }
) {
  const r = await pool.query(
    `INSERT INTO patient_medications (patient_id, medication_name, dosage, frequency, timing_instructions, start_date, end_date, source)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,'manual') RETURNING *`,
    [
      patientId,
      body.medication_name,
      body.dosage || null,
      body.frequency || null,
      body.timing_instructions || null,
      body.start_date,
      body.end_date || null,
    ]
  );
  return { medication: r.rows[0] };
}

export async function patchMedication(patientId: string, medId: string, body: { is_active?: boolean; end_date?: string; notes?: string }) {
  const r = await pool.query(
    `UPDATE patient_medications SET is_active = COALESCE($3, is_active), end_date = COALESCE($4::date, end_date), notes = COALESCE($5, notes)
     WHERE id = $1 AND patient_id = $2 RETURNING *`,
    [medId, patientId, body.is_active, body.end_date || null, body.notes || null]
  );
  return r.rows[0];
}

export async function fullHistory(patientId: string) {
  const patient = await getPatient(patientId);
  const triage = await pool.query(`SELECT * FROM triage_sessions WHERE patient_id = $1 ORDER BY created_at DESC`, [patientId]);
  const consults = await pool.query(`SELECT * FROM consultations WHERE patient_id = $1 ORDER BY created_at DESC`, [patientId]);
  const wear = await pool.query(
    `SELECT * FROM wearable_data WHERE patient_id = $1 AND recorded_at > NOW() - INTERVAL '30 days'`,
    [patientId]
  );
  return { ...patient, triage_sessions: triage.rows, consultations: consults.rows, wearable_30d: wear.rows };
}
