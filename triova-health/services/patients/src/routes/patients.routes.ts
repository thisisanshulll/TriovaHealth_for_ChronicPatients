import { Router } from 'express';
import * as patientsController from '../controllers/patients.controller.js';
import { authMiddleware } from '../../shared/middleware/auth.middleware.js';

const router = Router();

router.get('/:id', authMiddleware, patientsController.getPatient);
router.patch('/:id', authMiddleware, patientsController.updatePatient);
router.post('/:id/allergies', authMiddleware, patientsController.addAllergy);
router.delete('/:id/allergies/:allergy_id', authMiddleware, patientsController.deleteAllergy);
router.post('/:id/conditions', authMiddleware, patientsController.addCondition);
router.post('/:id/medications', authMiddleware, patientsController.addMedication);
router.patch('/:id/medications/:medication_id', authMiddleware, patientsController.updateMedication);
router.get('/:id/full-history', authMiddleware, patientsController.getFullHistory);

export default router;
