import { Request, Response } from 'express';
import { pool } from '../../shared/db/pool.js';
import { ok, err } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

export const getPatient = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;

    if (user.patientId !== id && user.role !== 'doctor') {
      return err(res, 'Forbidden', 403);
    }

    const patient = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    const allergies = await pool.query('SELECT * FROM patient_allergies WHERE patient_id = $1', [id]);
    const conditions = await pool.query('SELECT * FROM patient_chronic_conditions WHERE patient_id = $1', [id]);
    const medications = await pool.query('SELECT * FROM patient_medications WHERE patient_id = $1 AND is_active = true', [id]);

    return ok(res, { 
      patient: patient.rows[0], 
      allergies: allergies.rows,
      chronic_conditions: conditions.rows,
      active_medications: medications.rows
    });
  } catch (error) {
    logger.error('Get patient failed', { error });
    return err(res, 'Failed to get patient', 500);
  }
};

export const updatePatient = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    const updates = req.body;

    if (user.patientId !== id) {
      return err(res, 'Forbidden', 403);
    }

    const fields = Object.keys(updates).filter(k => k !== 'id');
    if (fields.length === 0) return err(res, 'No fields to update', 400);

    const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = fields.map(f => updates[f]);
    
    const result = await pool.query(
      `UPDATE patients SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    return ok(res, { patient: result.rows[0] });
  } catch (error) {
    logger.error('Update patient failed', { error });
    return err(res, 'Failed to update', 500);
  }
};

export const addAllergy = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { allergen, severity, reaction_description, diagnosed_date } = req.body;

    const result = await pool.query(
      `INSERT INTO patient_allergies (patient_id, allergen, severity, reaction_description, diagnosed_date) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, allergen, severity, reaction_description, diagnosed_date]
    );

    return ok(res, { allergy: result.rows[0] }, 201);
  } catch (error) {
    logger.error('Add allergy failed', { error });
    return err(res, 'Failed to add', 500);
  }
};

export const deleteAllergy = async (req: Request, res: Response) => {
  try {
    const { id, allergy_id } = req.params;
    await pool.query('DELETE FROM patient_allergies WHERE id = $1 AND patient_id = $2', [allergy_id, id]);
    return ok(res, { message: 'Deleted' });
  } catch (error) {
    logger.error('Delete allergy failed', { error });
    return err(res, 'Failed to delete', 500);
  }
};

export const addCondition = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { condition_name, icd_code, diagnosed_date, notes } = req.body;

    const result = await pool.query(
      `INSERT INTO patient_chronic_conditions (patient_id, condition_name, icd_code, diagnosed_date, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, condition_name, icd_code, diagnosed_date, notes]
    );

    return ok(res, { condition: result.rows[0] }, 201);
  } catch (error) {
    logger.error('Add condition failed', { error });
    return err(res, 'Failed to add', 500);
  }
};

export const addMedication = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { medication_name, dosage, frequency, timing_instructions, start_date, end_date, notes } = req.body;

    const result = await pool.query(
      `INSERT INTO patient_medications (patient_id, medication_name, dosage, frequency, timing_instructions, start_date, end_date, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, medication_name, dosage, frequency, timing_instructions, start_date, end_date, notes]
    );

    return ok(res, { medication: result.rows[0] }, 201);
  } catch (error) {
    logger.error('Add medication failed', { error });
    return err(res, 'Failed to add', 500);
  }
};

export const updateMedication = async (req: Request, res: Response) => {
  try {
    const { id, medication_id } = req.params;
    const { is_active, end_date, notes } = req.body;

    let query = 'UPDATE patient_medications SET';
    const params: any[] = [id];
    const updates: string[] = [];

    if (is_active !== undefined) {
      params.push(is_active);
      updates.push(`is_active = $${params.length}`);
    }
    if (end_date) {
      params.push(end_date);
      updates.push(`end_date = $${params.length}`);
    }
    if (notes) {
      params.push(notes);
      updates.push(`notes = $${params.length}`);
    }

    params.push(medication_id);
    query += ` ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length} AND patient_id = $${1} RETURNING *`;

    const result = await pool.query(query, params);
    return ok(res, { medication: result.rows[0] });
  } catch (error) {
    logger.error('Update medication failed', { error });
    return err(res, 'Failed to update', 500);
  }
};

export const getFullHistory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;

    if (user.patientId !== id && user.role !== 'doctor') {
      return err(res, 'Forbidden', 403);
    }

    const patient = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    const allergies = await pool.query('SELECT * FROM patient_allergies WHERE patient_id = $1', [id]);
    const conditions = await pool.query('SELECT * FROM patient_chronic_conditions WHERE patient_id = $1', [id]);
    const medications = await pool.query('SELECT * FROM patient_medications WHERE patient_id = $1', [id]);

    return ok(res, {
      patient: patient.rows[0],
      allergies: allergies.rows,
      chronic_conditions: conditions.rows,
      medications: medications.rows
    });
  } catch (error) {
    logger.error('Get full history failed', { error });
    return err(res, 'Failed to get history', 500);
  }
};
