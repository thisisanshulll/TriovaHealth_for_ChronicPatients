import { Router } from 'express';
import multer from 'multer';
import {
  authMiddleware,
  apiRateLimit,
  ragChatRateLimit,
  uploadRateLimit,
  type AuthedRequest,
} from '@triova/shared';
import * as svc from '../services/records.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE_BYTES) || 20 * 1024 * 1024 },
});

const router = Router();
router.use(authMiddleware);
router.use(apiRateLimit);

router.post('/upload', uploadRateLimit, upload.single('file'), async (req: AuthedRequest, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const patient_id = String(req.body.patient_id);
    if (req.user!.role === 'patient' && req.user!.patientId !== patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const allowed = (process.env.ALLOWED_MIME_TYPES || 'application/pdf,image/jpeg,image/png,image/heic')
      .split(',')
      .map((s) => s.trim());
    if (!allowed.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Invalid MIME type' });
    }
    res.status(201).json(
      await svc.createUpload(
        patient_id,
        req.user!.id,
        req.body.document_type,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        req.body.document_date
      )
    );
  } catch (e) {
    next(e);
  }
});

router.get('/patient/:patient_id', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.listDocuments(req.params.patient_id, req.query as Record<string, string>));
  } catch (e) {
    next(e);
  }
});

router.get('/document/:document_id', async (req: AuthedRequest, res, next) => {
  try {
    const d = await svc.getDocument(req.params.document_id);
    if (req.user!.role === 'patient' && d.document.patient_id !== req.user!.patientId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(d);
  } catch (e) {
    next(e);
  }
});

router.delete('/document/:document_id', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role !== 'patient' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(
      await svc.deleteDocument(req.params.document_id, req.user!.patientId || null, req.user!.role)
    );
  } catch (e) {
    next(e);
  }
});

router.post('/chat', ragChatRateLimit, async (req: AuthedRequest, res, next) => {
  try {
    const pid = req.body.patient_id;
    if (req.user!.role === 'patient' && req.user!.patientId !== pid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(
      await svc.chatRecords({
        patient_id: pid,
        userId: req.user!.id,
        role: req.user!.role,
        query: req.body.query,
        conversation_history: req.body.conversation_history,
        session_key: req.body.session_key,
      })
    );
  } catch (e) {
    next(e);
  }
});

router.get('/chat-history/:patient_id', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await svc.chatHistory(req.params.patient_id));
  } catch (e) {
    next(e);
  }
});

router.get('/export/:patient_id', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await svc.exportPdf(req.params.patient_id, res);
  } catch (e) {
    next(e);
  }
});

router.post('/reprocess/:document_id', async (req: AuthedRequest, res) => {
  res.json({ status: 'queued' });
});

export default router;
