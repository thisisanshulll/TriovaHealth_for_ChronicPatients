import { Request, Response } from 'express';
import { pool } from '../../shared/db/pool.js';
import { ok, err } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

export const getDoctor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const doctor = await pool.query('SELECT * FROM doctors WHERE id = $1', [id]);
    const availability = await pool.query('SELECT * FROM doctor_availability WHERE doctor_id = $1', [id]);

    return ok(res, { doctor: doctor.rows[0], availability_schedule: availability.rows });
  } catch (error) {
    logger.error('Get doctor failed', { error });
    return err(res, 'Failed to get doctor', 500);
  }
};

export const getDoctors = async (req: Request, res: Response) => {
  try {
    const { specialization, is_available } = req.query;

    let query = `SELECT id, first_name, last_name, specialization, qualification, experience_years, consultation_fee, bio, is_available FROM doctors WHERE 1=1`;
    const params: any[] = [];

    if (specialization) {
      query += ` AND specialization = $${params.length + 1}`;
      params.push(specialization);
    }
    if (is_available !== undefined) {
      query += ` AND is_available = $${params.length + 1}`;
      params.push(is_available === 'true');
    }

    const result = await pool.query(query, params);
    return ok(res, { doctors: result.rows });
  } catch (error) {
    logger.error('Get doctors failed', { error });
    return err(res, 'Failed to get doctors', 500);
  }
};

export const updateDoctor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    const updates = req.body;

    if (user.doctorId !== id) return err(res, 'Forbidden', 403);

    const fields = Object.keys(updates);
    if (fields.length === 0) return err(res, 'No fields to update', 400);

    const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = fields.map(f => updates[f]);

    const result = await pool.query(
      `UPDATE doctors SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    return ok(res, { doctor: result.rows[0] });
  } catch (error) {
    logger.error('Update doctor failed', { error });
    return err(res, 'Failed to update', 500);
  }
};

export const getDoctorPatients = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { urgency, limit = 20, offset = 0 } = req.query;

    let query = `SELECT p.*, a.urgency, a.appointment_date, a.status as appt_status
                 FROM doctor_patient_assignments dpa
                 JOIN patients p ON dpa.patient_id = p.id
                 LEFT JOIN appointments a ON a.patient_id = p.id AND a.appointment_date >= CURRENT_DATE
                 WHERE dpa.doctor_id = $1`;
    const params: any[] = [id];

    if (urgency) {
      query += ` AND a.urgency = $${params.length + 1}`;
      params.push(urgency);
    }

    query += ` ORDER BY a.urgency DESC, a.appointment_date LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return ok(res, { patients: result.rows });
  } catch (error) {
    logger.error('Get patients failed', { error });
    return err(res, 'Failed to get patients', 500);
  }
};

export const setAvailability = async (req: Request, res: Response) => {
  try {
    const { day_of_week, start_time, end_time, slot_duration_minutes = 30 } = req.body;
    const user = (req as any).user;

    const result = await pool.query(
      `INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [user.doctorId, day_of_week, start_time, end_time, slot_duration_minutes]
    );

    return ok(res, { availability: result.rows[0] }, 201);
  } catch (error) {
    logger.error('Set availability failed', { error });
    return err(res, 'Failed to set', 500);
  }
};

export const setUnavailability = async (req: Request, res: Response) => {
  try {
    const { date, start_time, end_time, is_full_day, reason } = req.body;
    const user = (req as any).user;

    const result = await pool.query(
      `INSERT INTO doctor_unavailability (doctor_id, unavailable_date, start_time, end_time, is_full_day, reason) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [user.doctorId, date, start_time, end_time, is_full_day, reason]
    );

    return ok(res, { unavailability: result.rows[0] }, 201);
  } catch (error) {
    logger.error('Set unavailability failed', { error });
    return err(res, 'Failed to set', 500);
  }
};

export const createConsultation = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { appointment_id, diagnosis, symptoms, prescription_text, tests_recommended, follow_up_date, consultation_notes, doctor_summary } = req.body;

    const apptResult = await pool.query('SELECT patient_id, doctor_id FROM appointments WHERE id = $1', [appointment_id]);
    if (apptResult.rows.length === 0) return err(res, 'Appointment not found', 404);

    const appt = apptResult.rows[0];
    if (appt.doctor_id !== user.doctorId) return err(res, 'Forbidden', 403);

    const result = await pool.query(
      `INSERT INTO consultations (appointment_id, patient_id, doctor_id, diagnosis, symptoms, prescription_text, tests_recommended, follow_up_date, consultation_notes, doctor_summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [appointment_id, appt.patient_id, appt.doctor_id, diagnosis, symptoms, prescription_text, tests_recommended, follow_up_date, consultation_notes, doctor_summary]
    );

    await pool.query(`UPDATE appointments SET status = 'completed' WHERE id = $1`, [appointment_id]);

    return ok(res, { consultation: result.rows[0] }, 201);
  } catch (error) {
    logger.error('Create consultation failed', { error });
    return err(res, 'Failed to create', 500);
  }
};

export const getConsultation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const consultation = await pool.query('SELECT * FROM consultations WHERE id = $1', [id]);
    const medications = await pool.query('SELECT * FROM prescribed_medications WHERE consultation_id = $1', [id]);

    return ok(res, { consultation: consultation.rows[0], prescribed_medications: medications.rows });
  } catch (error) {
    logger.error('Get consultation failed', { error });
    return err(res, 'Failed to get', 500);
  }
};

export const getPatientConsultations = async (req: Request, res: Response) => {
  try {
    const { patient_id } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT c.*, d.first_name as doctor_first_name, d.last_name as doctor_last_name, d.specialization
       FROM consultations c
       JOIN doctors d ON c.doctor_id = d.id
       WHERE c.patient_id = $1
       ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`,
      [patient_id, limit, offset]
    );

    return ok(res, { consultations: result.rows });
  } catch (error) {
    logger.error('Get consultations failed', { error });
    return err(res, 'Failed to get', 500);
  }
};

export const addPrescribedMedications = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { medications } = req.body;

    const results = [];
    for (const med of medications) {
      const result = await pool.query(
        `INSERT INTO prescribed_medications (consultation_id, medication_name, dosage, frequency, timing, duration_days, instructions) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, med.medication_name, med.dosage, med.frequency, med.timing, med.duration_days, med.instructions]
      );
      results.push(result.rows[0]);
    }

    return ok(res, { prescribed_medications: results }, 201);
  } catch (error) {
    logger.error('Add medications failed', { error });
    return err(res, 'Failed to add', 500);
  }
};
