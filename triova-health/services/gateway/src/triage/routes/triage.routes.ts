import { Router } from 'express';
import multer from 'multer';
import { authMiddleware, roleMiddleware, apiRateLimit, type AuthedRequest } from '@triova/shared';
import * as svc from '../services/triage.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE_BYTES) || 20 * 1024 * 1024 },
});

const router = Router();
router.use(authMiddleware);
router.use(apiRateLimit);

router.post('/start', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(
      await svc.startTriage(req.user!.patientId!, req.body.chief_complaint, req.body.language || 'en')
    );
  } catch (e) {
    next(e);
  }
});

router.post('/answer', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(
      await svc.answerTriage(
        req.user!.patientId!,
        req.body.session_id,
        req.body.question_key,
        req.body.response_text,
        req.body.response_value
      )
    );
  } catch (e) {
    next(e);
  }
});

router.post('/voice-answer', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.voiceAnswer(req.user!.patientId!, req.body.session_id, req.body.audio_base64));
  } catch (e) {
    next(e);
  }
});

router.post('/upload-image', roleMiddleware('patient'), upload.single('image'), async (req: AuthedRequest, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'image required' });
    res.json(
      await svc.uploadImage(
        req.user!.patientId!,
        req.body.session_id,
        req.file.buffer,
        req.file.mimetype
      )
    );
  } catch (e) {
    next(e);
  }
});

router.get('/summary/:session_id', async (req: AuthedRequest, res, next) => {
  try {
    const summary = await svc.getTriageSummary(req.params.session_id);
    if (req.user!.role === 'patient' && summary.patient_id !== req.user!.patientId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(summary);
  } catch (e) {
    next(e);
  }
});

router.get('/history/:patient_id', async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role === 'patient' && req.user!.patientId !== req.params.patient_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(
      await svc.triageHistory(
        req.params.patient_id,
        Number(req.query.limit) || 20,
        Number(req.query.offset) || 0
      )
    );
  } catch (e) {
    next(e);
  }
});

router.get('/questions', async (req, res, next) => {
  try {
    res.json(await svc.listQuestions(String(req.query.condition_category || 'general')));
  } catch (e) {
    next(e);
  }
});

router.post('/abandon/:session_id', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    res.json(await svc.abandon(req.params.session_id, req.user!.patientId!));
  } catch (e) {
    next(e);
  }
});

router.get('/active/:patient_id', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.patientId !== req.params.patient_id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await svc.activeSession(req.params.patient_id));
  } catch (e) {
    next(e);
  }
});

export default router;
