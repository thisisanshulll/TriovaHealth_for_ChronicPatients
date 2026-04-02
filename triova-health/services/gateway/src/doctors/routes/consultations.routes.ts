import { Router } from 'express';
import { authMiddleware, apiRateLimit, roleMiddleware, type AuthedRequest } from '@triova/shared';
import * as svc from '../services/doctors.service.js';
import { pool } from '@triova/shared';

const router = Router();
router.use(authMiddleware);
router.use(apiRateLimit);

router.post('/', roleMiddleware('doctor'), async (req: AuthedRequest, res, next) => {
  try {
    const ap = await pool.query(`SELECT patient_id, doctor_id FROM appointments WHERE id = $1`, [req.body.appointment_id]);
    if (!ap.rows[0]) return res.status(400).json({ error: 'Invalid appointment' });
    if (ap.rows[0].doctor_id !== req.user!.doctorId) return res.status(403).json({ error: 'Forbidden' });
    res.status(201).json(
      await svc.createConsultation({
        ...req.body,
        patient_id: ap.rows[0].patient_id,
        doctor_id: req.user!.doctorId!,
      })
    );
  } catch (e) {
    next(e);
  }
});

router.get('/patient/:patient_id', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.consultationsByPatient(req.params.patient_id));
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.getConsultation(req.params.id));
  } catch (e) {
    next(e);
  }
});

router.post('/:id/medications', roleMiddleware('doctor'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.addPrescribedMeds(req.params.id, req.body.medications));
  } catch (e) {
    next(e);
  }
});

export default router;
