import { Router } from 'express';
import * as triageController from '../controllers/triage.controller.js';
import { authMiddleware } from '../../shared/middleware/auth.middleware.js';

const router = Router();

router.post('/start', authMiddleware, triageController.startTriage);
router.post('/answer', authMiddleware, triageController.answerTriage);
router.get('/summary/:session_id', authMiddleware, triageController.getTriageSummary);
router.get('/history/:patient_id', authMiddleware, triageController.getTriageHistory);
router.get('/questions', authMiddleware, triageController.getQuestions);
router.post('/abandon/:session_id', authMiddleware, triageController.abandonTriage);
router.get('/active/:patient_id', authMiddleware, triageController.getActiveSession);

export default router;
