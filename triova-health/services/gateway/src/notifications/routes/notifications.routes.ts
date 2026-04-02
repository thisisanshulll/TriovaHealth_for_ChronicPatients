import { Router } from 'express';
import { authMiddleware, apiRateLimit, roleMiddleware, type AuthedRequest } from '@triova/shared';
import * as svc from '../services/notification.service.js';

const router = Router();
router.use(authMiddleware);
router.use(apiRateLimit);

router.get('/user/:user_id', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.id !== req.params.user_id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await svc.listForUser(req.params.user_id, req.query as Record<string, string>));
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/read', async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.markRead(req.params.id, req.user!.id));
  } catch (e) {
    next(e);
  }
});

router.patch('/user/:user_id/read-all', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.id !== req.params.user_id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await svc.markAllRead(req.params.user_id));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.removeNotification(req.params.id, req.user!.id));
  } catch (e) {
    next(e);
  }
});

router.get('/reminders/:patient_id', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.patientId !== req.params.patient_id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await svc.remindersForPatient(req.params.patient_id));
  } catch (e) {
    next(e);
  }
});

router.patch('/reminders/:reminder_id', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.patchReminder(req.params.reminder_id, req.user!.patientId!, req.body));
  } catch (e) {
    next(e);
  }
});

router.post('/reminders', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    res.status(201).json(
      await svc.createReminder(req.body.patient_id, req.body.medication_id, req.body.reminder_time)
    );
  } catch (e) {
    next(e);
  }
});

export default router;
