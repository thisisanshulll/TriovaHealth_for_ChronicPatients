import { Router } from 'express';
import * as appointmentController from '../controllers/appointment.controller.js';
import { authMiddleware } from '../../shared/middleware/auth.middleware.js';

const router = Router();

router.post('/book', authMiddleware, appointmentController.bookAppointment);
router.get('/available-slots', authMiddleware, appointmentController.getAvailableSlots);
router.get('/patient/:patient_id', authMiddleware, appointmentController.getPatientAppointments);
router.get('/doctor/:doctor_id', authMiddleware, appointmentController.getDoctorAppointments);
router.patch('/:id/status', authMiddleware, appointmentController.updateAppointmentStatus);
router.patch('/:id/cancel', authMiddleware, appointmentController.cancelAppointment);
router.get('/:id/queue-status', authMiddleware, appointmentController.getQueueStatus);
router.get('/slots/next-available', authMiddleware, appointmentController.getNextAvailableSlot);

export default router;
