import { Router } from 'express';
import * as analyticsController from '../controllers/analytics.controller.js';
import { authMiddleware } from '../../shared/middleware/auth.middleware.js';

const router = Router();

router.get('/patient/:patient_id/dashboard', authMiddleware, analyticsController.getPatientDashboard);
router.get('/patient/:patient_id/trends', authMiddleware, analyticsController.getPatientTrends);
router.get('/patient/:patient_id/alerts', authMiddleware, analyticsController.getPatientAlerts);
router.get('/patient/:patient_id/health-score', authMiddleware, analyticsController.getHealthScore);
router.get('/doctor/:doctor_id/dashboard', authMiddleware, analyticsController.getDoctorDashboard);
router.patch('/alerts/:alert_id/acknowledge', authMiddleware, analyticsController.acknowledgeAlert);
router.patch('/alerts/:alert_id/resolve', authMiddleware, analyticsController.resolveAlert);

export default router;
