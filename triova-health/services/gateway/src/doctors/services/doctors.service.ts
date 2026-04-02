import { pool } from '@triova/shared';

export async function getDoctor(id: string) {
  const d = await pool.query(`SELECT * FROM doctors WHERE id = $1`, [id]);
  if (!d.rows[0]) throw Object.assign(new Error('Not found'), { status: 404 });
  const avail = await pool.query(`SELECT * FROM doctor_availability WHERE doctor_id = $1 AND is_active = true`, [id]);
  return { doctor: d.rows[0], availability_schedule: avail.rows };
}

export async function listDoctors(q: { specialization?: string; is_available?: string }) {
  let sql = `SELECT * FROM doctors WHERE 1=1`;
  const p: unknown[] = [];
  let i = 1;
  if (q.specialization) {
    sql += ` AND specialization ILIKE $${i++}`;
    p.push(`%${q.specialization}%`);
  }
  if (q.is_available === 'true') sql += ` AND is_available = true`;
  const r = await pool.query(sql, p);
  return { doctors: r.rows };
}

export async function patchDoctor(id: string, body: Record<string, unknown>) {
  const r = await pool.query(
    `UPDATE doctors SET bio = COALESCE($1, bio), consultation_fee = COALESCE($2, consultation_fee),
     is_available = COALESCE($3, is_available), average_consultation_time_minutes = COALESCE($4, average_consultation_time_minutes)
     WHERE id = $5 RETURNING *`,
    [body.bio, body.consultation_fee, body.is_available, body.average_consultation_time_minutes, id]
  );
  return r.rows[0];
}

export async function doctorPatients(doctorId: string, q: { urgency?: string; limit?: number; offset?: number }) {
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;
  const urgency = q.urgency;
  const r = await pool.query(
    `SELECT p.*, ts.urgency_level, ts.chief_complaint, ts.ai_summary
     FROM doctor_patient_assignments dpa
     JOIN patients p ON p.id = dpa.patient_id
     LEFT JOIN LATERAL (SELECT * FROM triage_sessions WHERE patient_id = p.id ORDER BY completed_at DESC NULLS LAST LIMIT 1) ts ON true
     WHERE dpa.doctor_id = $1
       AND ($2::urgency_level IS NULL OR ts.urgency_level = $2::urgency_level)
     LIMIT $3 OFFSET $4`,
    [doctorId, urgency || null, limit, offset]
  );
  return { patients: r.rows };
}

export async function createConsultation(input: {
  appointment_id: string;
  patient_id: string;
  doctor_id: string;
  diagnosis?: string;
  symptoms?: string[];
  prescription_text?: string;
  tests_recommended?: string[];
  follow_up_date?: string;
  consultation_notes?: string;
}) {
  const r = await pool.query(
    `INSERT INTO consultations (appointment_id, patient_id, doctor_id, diagnosis, symptoms, prescription_text, tests_recommended, follow_up_date, consultation_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9) RETURNING *`,
    [
      input.appointment_id,
      input.patient_id,
      input.doctor_id,
      input.diagnosis || null,
      input.symptoms || null,
      input.prescription_text || null,
      input.tests_recommended || null,
      input.follow_up_date || null,
      input.consultation_notes || null,
    ]
  );
  return { consultation: r.rows[0] };
}

export async function getConsultation(id: string) {
  const c = await pool.query(`SELECT * FROM consultations WHERE id = $1`, [id]);
  if (!c.rows[0]) throw Object.assign(new Error('Not found'), { status: 404 });
  const m = await pool.query(`SELECT * FROM prescribed_medications WHERE consultation_id = $1`, [id]);
  return { consultation: c.rows[0], prescribed_medications: m.rows };
}

export async function consultationsByPatient(patientId: string) {
  const r = await pool.query(
    `SELECT c.*, d.first_name AS doc_first, d.last_name AS doc_last FROM consultations c
     JOIN doctors d ON d.id = c.doctor_id WHERE c.patient_id = $1 ORDER BY c.created_at DESC`,
    [patientId]
  );
  return { consultations: r.rows };
}

export async function addPrescribedMeds(consultationId: string, medications: Array<Record<string, unknown>>) {
  const out = [];
  for (const m of medications) {
    const r = await pool.query(
      `INSERT INTO prescribed_medications (consultation_id, medication_name, dosage, frequency, timing, duration_days, instructions)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        consultationId,
        m.medication_name,
        m.dosage,
        m.frequency,
        m.timing || null,
        m.duration_days || null,
        m.instructions || null,
      ]
    );
    out.push(r.rows[0]);
  }
  return { prescribed_medications: out };
}
