import { Router } from 'express';
import { authMiddleware, apiRateLimit, roleMiddleware, type AuthedRequest } from '@triova/shared';
import { pool } from '@triova/shared';

const router = Router();
router.use(authMiddleware);
router.use(apiRateLimit);

router.get('/patient/:patient_id', async (req: AuthedRequest, res, next) => {
  try {
    const patientId = req.params.patient_id;
    if (req.user!.role === 'patient' && req.user!.patientId !== patientId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const meds = await pool.query(
      `SELECT id, medication_name, dosage, frequency, timing_instructions, start_date, end_date, is_active, source
       FROM patient_medications 
       WHERE patient_id = $1
       ORDER BY created_at DESC`,
      [patientId]
    );
    
    const reminders = await pool.query(
      `SELECT mr.id, mr.medication_id, mr.reminder_time, mr.is_active, pm.medication_name
       FROM medication_reminders mr
       JOIN patient_medications pm ON mr.medication_id = pm.id
       WHERE pm.patient_id = $1
       ORDER BY mr.reminder_time`,
      [patientId]
    );
    
    res.json({
      medications: meds.rows,
      reminders: reminders.rows
    });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const { patient_id, medication_name, dosage, frequency, timing_instructions, duration_days, reminder_times } = req.body;
    
    // Patients can only add meds for themselves; doctors can add for any patient
    if (req.user!.role === 'patient' && req.user!.patientId !== patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const source = req.user!.role === 'patient' ? 'prescription_scan' : 'manual';
    const endDate = duration_days ? `CURRENT_DATE + INTERVAL '${duration_days} days'` : 'NULL';
    
    const ins = await pool.query(
      `INSERT INTO patient_medications (patient_id, medication_name, dosage, frequency, timing_instructions, start_date, end_date, source, prescribed_by, is_active)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, ${endDate}, $6, $7, true) 
       RETURNING id`,
      [patient_id, medication_name, dosage, frequency, timing_instructions, source, req.user!.id]
    );
    
    const medId = ins.rows[0].id;
    
    if (reminder_times && reminder_times.length > 0) {
      for (const time of reminder_times) {
        await pool.query(
          `INSERT INTO medication_reminders (patient_id, medication_id, reminder_time, is_active) 
           VALUES ($1, $2, $3, true)`,
          [patient_id, medId, time]
        );
      }
    } else {
      const defaultTimes = ['09:00:00'];
      if (frequency?.toLowerCase().includes('twice')) defaultTimes.push('21:00:00');
      if (frequency?.toLowerCase().includes('three')) defaultTimes.push('14:00:00');
      
      for (const time of defaultTimes) {
        await pool.query(
          `INSERT INTO medication_reminders (patient_id, medication_id, reminder_time, is_active) 
           VALUES ($1, $2, $3, true)`,
          [patient_id, medId, time]
        );
      }
    }
    
    res.status(201).json({ id: medId, message: 'Medication added successfully' });
  } catch (e) {
    next(e);
  }
});

router.patch('/:medication_id', roleMiddleware('doctor', 'patient'), async (req: AuthedRequest, res, next) => {
  try {
    const { is_active, dosage, frequency, timing_instructions } = req.body;
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    
    if (is_active !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(is_active);
    }
    if (dosage) {
      updates.push(`dosage = $${idx++}`);
      values.push(dosage);
    }
    if (frequency) {
      updates.push(`frequency = $${idx++}`);
      values.push(frequency);
    }
    if (timing_instructions) {
      updates.push(`timing_instructions = $${idx++}`);
      values.push(timing_instructions);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }
    
    values.push(req.params.medication_id);
    
    await pool.query(
      `UPDATE patient_medications SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );
    
    res.json({ message: 'Medication updated' });
  } catch (e) {
    next(e);
  }
});

router.delete('/:medication_id', roleMiddleware('doctor', 'patient'), async (req: AuthedRequest, res, next) => {
  try {
    await pool.query(
      `UPDATE patient_medications SET is_active = false WHERE id = $1`,
      [req.params.medication_id]
    );
    res.json({ message: 'Medication deactivated' });
  } catch (e) {
    next(e);
  }
});

router.patch('/reminder/:reminder_id', async (req: AuthedRequest, res, next) => {
  try {
    const { is_active, reminder_time } = req.body;
    
    if (is_active !== undefined) {
      await pool.query(
        `UPDATE medication_reminders SET is_active = $1 WHERE id = $2`,
        [is_active, req.params.reminder_id]
      );
    }
    
    if (reminder_time) {
      await pool.query(
        `UPDATE medication_reminders SET reminder_time = $1 WHERE id = $2`,
        [reminder_time, req.params.reminder_id]
      );
    }
    
    res.json({ message: 'Reminder updated' });
  } catch (e) {
    next(e);
  }
});

export default router;