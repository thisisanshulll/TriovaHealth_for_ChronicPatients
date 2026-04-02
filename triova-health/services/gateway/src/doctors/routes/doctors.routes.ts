import { Router } from 'express';
import { authMiddleware, apiRateLimit, roleMiddleware, type AuthedRequest } from '@triova/shared';
import * as svc from '../services/doctors.service.js';

const router = Router();
router.use(authMiddleware);
router.use(apiRateLimit);

router.get('/', async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.listDoctors(req.query as Record<string, string>));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/patients', roleMiddleware('doctor'), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.doctorId !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await svc.doctorPatients(req.params.id, req.query as Record<string, string>));
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.getDoctor(req.params.id));
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', roleMiddleware('doctor'), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.doctorId !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await svc.patchDoctor(req.params.id, req.body));
  } catch (e) {
    next(e);
  }
});

export default router;
