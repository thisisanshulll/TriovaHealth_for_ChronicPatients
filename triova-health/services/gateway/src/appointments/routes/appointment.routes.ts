import { Router } from 'express';
import { z } from 'zod';
import {
  authMiddleware,
  apiRateLimit,
  validateBody,
  roleMiddleware,
  type AuthedRequest,
} from '@triova/shared';
import * as svc from '../services/appointment.service.js';

const router = Router();

router.use(authMiddleware);
router.use(apiRateLimit);

router.post('/voice-booking', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    const data = await svc.voiceBooking(req.user!.patientId!, req.user!.id, req.body.audio_base64);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

const bookSchema = z.object({
  doctor_id: z.string().uuid(),
  date: z.string(),
  time: z.string(),
  urgency: z.string().optional(),
  chief_complaint: z.string().optional(),
  booking_notes: z.string().optional(),
});

router.post('/book', roleMiddleware('patient'), validateBody(bookSchema), async (req: AuthedRequest, res, next) => {
  try {
    const data = await svc.bookAppointment({
      patientId: req.user!.patientId!,
      patientUserId: req.user!.id,
      booking_method: 'manual',
      ...req.body,
    });
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

router.get('/available-slots', async (req: AuthedRequest, res, next) => {
  try {
    const doctor_id = String(req.query.doctor_id);
    const date = String(req.query.date);
    res.json(await svc.getAvailableSlots(doctor_id, date));
  } catch (e) {
    next(e);
  }
});

router.get('/patient/:patient_id', async (req: AuthedRequest, res, next) => {
  try {
    const pid = req.params.patient_id;
    if (req.user!.role === 'patient' && req.user!.patientId !== pid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.listPatientAppointments(pid, req.query as Record<string, string>));
  } catch (e) {
    next(e);
  }
});

router.get('/doctor/:doctor_id', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'doctor' && req.user!.doctorId !== req.params.doctor_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.listDoctorAppointments(req.params.doctor_id, req.query as Record<string, string>));
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/status', roleMiddleware('doctor', 'admin'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.patchStatus(req.params.id, req.body.status, req.body.cancellation_reason, req.user!.id));
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/cancel', async (req: AuthedRequest, res, next) => {
  try {
    const role = req.user!.role;
    const patientId = role === 'patient' ? req.user!.patientId! : null;
    res.json(await svc.cancelAppointment(req.params.id, patientId, role, req.body.reason));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/queue-status', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.queueStatus(req.params.id, req.user!.patientId!));
  } catch (e) {
    next(e);
  }
});

router.post('/availability', roleMiddleware('doctor'), async (req: AuthedRequest, res, next) => {
  try {
    res.status(201).json(await svc.setAvailability(req.user!.doctorId!, req.body));
  } catch (e) {
    next(e);
  }
});

router.patch('/availability/:id', roleMiddleware('doctor'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.patchAvailability(req.params.id, req.user!.doctorId!, req.body));
  } catch (e) {
    next(e);
  }
});

router.post('/unavailability', roleMiddleware('doctor'), async (req: AuthedRequest, res, next) => {
  try {
    res.status(201).json(await svc.addUnavailability(req.user!.doctorId!, req.body));
  } catch (e) {
    next(e);
  }
});

router.get('/slots/next-available', async (req: AuthedRequest, res, next) => {
  try {
    const doctor_id = String(req.query.doctor_id);
    const from_date = req.query.from_date ? String(req.query.from_date) : undefined;
    const urgency = req.query.urgency ? String(req.query.urgency) : undefined;
    res.json(await svc.nextAvailable(doctor_id, from_date, urgency));
  } catch (e) {
    next(e);
  }
});

export default router;
