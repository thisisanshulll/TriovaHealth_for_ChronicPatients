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
      await svc.startTriage(
        req.user!.patientId!, 
        req.body.chief_complaint, 
        req.body.language || 'en',
        req.body.condition_category
      )
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

// NEW: Generate SOAP clinical summary via Groq and notify doctor via socket
router.post('/generate-summary', roleMiddleware('patient'), async (req: AuthedRequest, res, next) => {
  try {
    const result = await svc.generateSoapSummary(
      req.body.session_id,
      req.user!.patientId!
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// NEW: Demo trigger — manually schedule triage for all active patients
router.post('/schedule-trigger', async (req: AuthedRequest, res, next) => {
  try {
    const { pool } = await import('@triova/shared');
    const patients = await pool.query(
      `SELECT id FROM patients WHERE is_active = true`
    );
    const weekNumber = Math.ceil(
      (new Date().getTime() - new Date(new Date().getFullYear(), 0, 1).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
    );
    for (const row of patients.rows) {
      // Skip if they already have a scheduled session this week
      const existing = await pool.query(
        `SELECT id FROM triage_sessions WHERE patient_id = $1 AND status = 'in_progress' AND started_at > NOW() - INTERVAL '7 days'`,
        [row.id]
      );
      if (!existing.rows.length) {
        await pool.query(
          `INSERT INTO triage_sessions (patient_id, status, language, chief_complaint, condition_category)
           VALUES ($1, 'in_progress', 'en', 'Weekly automated check-in', 'general')`,
          [row.id]
        );
      }
    }
    res.json({ triggered: patients.rows.length, week_number: weekNumber });
  } catch (e) {
    next(e);
  }
});

export default router;

