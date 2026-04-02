import { Router } from 'express';
import { authMiddleware, apiRateLimit, roleMiddleware, type AuthedRequest } from '@triova/shared';
import * as svc from '../services/patients.service.js';

const router = Router();
router.use(authMiddleware);
router.use(apiRateLimit);

router.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.getPatient(req.params.id));
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.patientId !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await svc.patchPatient(req.params.id, req.body));
  } catch (e) {
    next(e);
  }
});

router.post('/:id/allergies', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.patientId !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    res.status(201).json(await svc.addAllergy(req.params.id, req.body));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/allergies/:allergy_id', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.patientId !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    await svc.deleteAllergy(req.params.id, req.params.allergy_id);
    res.json({ message: 'Deleted' });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/conditions', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.status(201).json(await svc.addCondition(req.params.id, req.body));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/conditions/:condition_id', roleMiddleware('doctor', 'admin'), async (req, res, next) => {
  try {
    await svc.deleteCondition(req.params.id, req.params.condition_id);
    res.json({ message: 'Deleted' });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/medications', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.patientId !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    res.status(201).json(await svc.addMedication(req.params.id, req.body));
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/medications/:medication_id', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.patientId !== req.params.id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await svc.patchMedication(req.params.id, req.params.medication_id, req.body));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/full-history', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.fullHistory(req.params.id));
  } catch (e) {
    next(e);
  }
});

export default router;
