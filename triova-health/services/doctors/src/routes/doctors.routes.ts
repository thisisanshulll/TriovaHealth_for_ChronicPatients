import { Router } from 'express';
import * as doctorsController from '../controllers/doctors.controller.js';
import { authMiddleware } from '../../shared/middleware/auth.middleware.js';

const router = Router();

router.get('/:id', authMiddleware, doctorsController.getDoctor);
router.get('/', authMiddleware, doctorsController.getDoctors);
router.patch('/:id', authMiddleware, doctorsController.updateDoctor);
router.get('/:id/patients', authMiddleware, doctorsController.getDoctorPatients);
router.post('/availability', authMiddleware, doctorsController.setAvailability);
router.post('/unavailability', authMiddleware, doctorsController.setUnavailability);

export default router;
