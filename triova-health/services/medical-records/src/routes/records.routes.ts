import { Router } from 'express';
import multer from 'multer';
import * as recordsController from '../controllers/records.controller.js';
import { authMiddleware } from '../../shared/middleware/auth.middleware.js';

const router = Router();
const upload = multer({ dest: 'uploads/' });

router.post('/upload', authMiddleware, upload.single('file'), recordsController.uploadDocument);
router.get('/patient/:patient_id', authMiddleware, recordsController.getPatientDocuments);
router.get('/document/:document_id', authMiddleware, recordsController.getDocument);
router.delete('/document/:document_id', authMiddleware, recordsController.deleteDocument);
router.post('/chat', authMiddleware, recordsController.ragChat);
router.get('/chat-history/:patient_id', authMiddleware, recordsController.getChatHistory);

export default router;
