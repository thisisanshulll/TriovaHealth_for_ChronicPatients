import { Router } from 'express';
import { authMiddleware, apiRateLimit, roleMiddleware, type AuthedRequest } from '@triova/shared';
import * as svc from '../services/analytics.service.js';

const router = Router();
router.use(authMiddleware);
router.use(apiRateLimit);

router.get('/patient/:patient_id/dashboard', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.patientDashboard(req.params.patient_id));
  } catch (e) {
    next(e);
  }
});

router.get('/doctor/:doctor_id/dashboard', roleMiddleware('doctor'), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.doctorId !== req.params.doctor_id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await svc.doctorDashboard(req.params.doctor_id, req.query.date as string | undefined));
  } catch (e) {
    next(e);
  }
});

router.get('/patient/:patient_id/trends', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(
      await svc.patientTrends(
        req.params.patient_id,
        String(req.query.metric || 'heart_rate'),
        Number(req.query.days) || 7
      )
    );
  } catch (e) {
    next(e);
  }
});

router.get('/patient/:patient_id/alerts', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.patientAlerts(req.params.patient_id, req.query as Record<string, string>));
  } catch (e) {
    next(e);
  }
});

router.patch('/alerts/:alert_id/acknowledge', roleMiddleware('doctor'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.acknowledgeAlert(req.params.alert_id, req.user!.id));
  } catch (e) {
    next(e);
  }
});

router.patch('/alerts/:alert_id/resolve', roleMiddleware('doctor'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.resolveAlert(req.params.alert_id));
  } catch (e) {
    next(e);
  }
});

router.get('/patient/:patient_id/health-score', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.healthScoreDetail(req.params.patient_id));
  } catch (e) {
    next(e);
  }
});

router.get('/doctor/:doctor_id/performance', async (req: AuthedRequest, res, next) => {
  try {
    res.json(
      await svc.doctorPerformance(
        req.params.doctor_id,
        String(req.query.from_date),
        String(req.query.to_date)
      )
    );
  } catch (e) {
    next(e);
  }
});

export default router;
