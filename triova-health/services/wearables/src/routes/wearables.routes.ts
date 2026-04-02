import { Router } from 'express';
import * as wearablesController from '../controllers/wearables.controller.js';
import { authMiddleware } from '../../shared/middleware/auth.middleware.js';

const router = Router();

router.post('/sync/:patient_id', authMiddleware, wearablesController.syncWearableData);
router.get('/patient/:patient_id/latest', authMiddleware, wearablesController.getLatestVitals);
router.get('/patient/:patient_id/history', authMiddleware, wearablesController.getVitalsHistory);
router.post('/patient/:patient_id/reading', authMiddleware, wearablesController.addManualReading);
router.post('/simulate-anomaly', authMiddleware, wearablesController.simulateAnomaly);

export default router;
