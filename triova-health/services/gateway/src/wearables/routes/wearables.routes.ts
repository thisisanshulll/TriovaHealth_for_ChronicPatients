import { Router } from 'express';
import { authMiddleware, apiRateLimit, roleMiddleware, type AuthedRequest } from '@triova/shared';
import * as svc from '../services/mock-wearable.service.js';

const router = Router();
router.use(authMiddleware);
router.use(apiRateLimit);

router.post('/sync/:patient_id', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.syncMockReading(req.params.patient_id));
  } catch (e) {
    next(e);
  }
});

router.get('/patient/:patient_id/latest', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.latest(req.params.patient_id));
  } catch (e) {
    next(e);
  }
});

router.get('/patient/:patient_id/history', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.history(req.params.patient_id, req.query as Record<string, string>));
  } catch (e) {
    next(e);
  }
});

router.post('/patient/:patient_id/reading', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.status(201).json(await svc.manualReading(req.params.patient_id, req.body));
  } catch (e) {
    next(e);
  }
});

router.post('/simulate-anomaly', roleMiddleware('admin'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.simulateAnomaly(req.body.patient_id, req.body.metric, req.body.severity));
  } catch (e) {
    next(e);
  }
});

export default router;
