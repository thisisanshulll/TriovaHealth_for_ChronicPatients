import { Router } from 'express';
import * as doctorsController from '../controllers/doctors.controller.js';
import { authMiddleware } from '../../shared/middleware/auth.middleware.js';

const router = Router();

router.post('/', authMiddleware, doctorsController.createConsultation);
router.get('/:id', authMiddleware, doctorsController.getConsultation);
router.get('/patient/:patient_id', authMiddleware, doctorsController.getPatientConsultations);
router.post('/:id/medications', authMiddleware, doctorsController.addPrescribedMedications);

export default router;
