import { Request, Response } from 'express';
import { pool } from '../../shared/db/pool.js';
import { ok, err } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

const QUESTION_BANK: Record<string, any[]> = {
  heart: [
    { key: 'chest_pain', text_en: 'Are you experiencing chest pain or discomfort?', type: 'yes_no', is_critical: true },
    { key: 'pain_duration', text_en: 'How long have you had this chest pain?', type: 'duration' },
    { key: 'pain_radiation', text_en: 'Does the pain spread to your arm, jaw, neck, or back?', type: 'yes_no', is_critical: true },
    { key: 'shortness_of_breath', text_en: 'Are you short of breath?', type: 'yes_no', is_critical: true },
    { key: 'sweating_nausea', text_en: 'Are you sweating or feeling nauseous?', type: 'yes_no' },
    { key: 'heart_history', text_en: 'Do you have a history of heart disease?', type: 'yes_no' },
  ],
  respiratory: [
    { key: 'breathing_difficulty', text_en: 'Are you having difficulty breathing right now?', type: 'yes_no', is_critical: true },
    { key: 'breathing_severity', text_en: 'On a scale of 1 to 10, how severe is your breathing difficulty?', type: 'scale' },
    { key: 'cough_type', text_en: 'Do you have a cough? Is it dry or bringing up mucus?', type: 'choice', choices: ['No cough', 'Dry cough', 'Wet/productive cough'] },
    { key: 'onset_duration', text_en: 'When did your breathing problems start?', type: 'duration' },
    { key: 'fever', text_en: 'Do you have a fever?', type: 'yes_no' },
    { key: 'asthma_history', text_en: 'Do you have asthma or COPD?', type: 'yes_no' },
  ],
  digestive: [
    { key: 'pain_location', text_en: 'Where exactly is your stomach pain?', type: 'text' },
    { key: 'pain_severity', text_en: 'Rate your pain from 1 to 10', type: 'scale' },
    { key: 'nausea_vomiting', text_en: 'Are you experiencing nausea or vomiting?', type: 'yes_no' },
    { key: 'blood_in_stool', text_en: 'Have you noticed any blood in your stool or vomit?', type: 'yes_no', is_critical: true },
    { key: 'last_meal', text_en: 'When did you last eat, and what did you have?', type: 'text' },
  ],
  neurological: [
    { key: 'headache_severity', text_en: 'Rate your headache from 1 to 10. Is this the worst headache of your life?', type: 'scale', is_critical: true },
    { key: 'sudden_onset', text_en: 'Did the headache come on suddenly?', type: 'yes_no', is_critical: true },
    { key: 'vision_changes', text_en: 'Are you having any vision changes or double vision?', type: 'yes_no', is_critical: true },
    { key: 'weakness_numbness', text_en: 'Do you have any weakness or numbness in your face, arm, or leg?', type: 'yes_no', is_critical: true },
    { key: 'speech_difficulty', text_en: 'Are you having difficulty speaking?', type: 'yes_no', is_critical: true },
  ],
  general: [
    { key: 'main_complaint', text_en: 'Please describe your main problem in your own words', type: 'text' },
    { key: 'duration', text_en: 'How long have you been experiencing this?', type: 'duration' },
    { key: 'severity', text_en: 'On a scale of 1 to 10, how much is this affecting your daily life?', type: 'scale' },
    { key: 'getting_worse', text_en: 'Is it getting better, worse, or staying the same?', type: 'choice', choices: ['Getting better', 'Getting worse', 'Same'] },
    { key: 'current_medications', text_en: 'Are you currently taking any medications?', type: 'text' },
    { key: 'allergies', text_en: 'Do you have any known allergies?', type: 'text' },
  ]
};

const EMERGENCY_KEYWORDS = [
  'chest pain', "can't breathe", 'can not breathe', 'heart attack',
  'stroke', 'unconscious', 'passed out', 'bleeding heavily', 'blood',
  'suicide', 'kill myself', 'severe pain', 'worst pain', 'thunderclap',
  "can't speak", 'face drooping', 'arm weakness', 'severe allergic'
];

function detectCategory(complaint: string): string {
  const lower = complaint.toLowerCase();
  if (lower.includes('chest') || lower.includes('heart') || lower.includes('palpitation')) return 'heart';
  if (lower.includes('breath') || lower.includes('cough') || lower.includes('asthma') || lower.includes('wheeze')) return 'respiratory';
  if (lower.includes('stomach') || lower.includes('nausea') || lower.includes('vomit') || lower.includes('diarrhea')) return 'digestive';
  if (lower.includes('headache') || lower.includes('dizz') || lower.includes('seizure') || lower.includes('numb')) return 'neurological';
  return 'general';
}

function detectEmergency(text: string): boolean {
  const lower = text.toLowerCase();
  return EMERGENCY_KEYWORDS.some(kw => lower.includes(kw));
}

export const startTriage = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user.patientId) return err(res, 'Patient not found', 404);

    const { chief_complaint, language = 'en' } = req.body;

    const existingSession = await pool.query(
      `SELECT id FROM triage_sessions WHERE patient_id = $1 AND status = 'in_progress' AND started_at > NOW() - INTERVAL '24 hours'`,
      [user.patientId]
    );

    if (existingSession.rows.length > 0) {
      const session = existingSession.rows[0];
      const lastResponse = await pool.query(
        `SELECT question_key FROM triage_responses WHERE triage_session_id = $1 ORDER BY response_order DESC LIMIT 1`,
        [session.id]
      );
      const category = await pool.query(`SELECT condition_category FROM triage_sessions WHERE id = $1`, [session.id]);
      
      const questions = QUESTION_BANK[category.rows[0]?.condition_category || 'general'];
      let nextQuestion = questions[0];
      if (lastResponse.rows.length > 0) {
        const lastIdx = questions.findIndex(q => q.key === lastResponse.rows[0].question_key);
        if (lastIdx >= 0 && lastIdx < questions.length - 1) {
          nextQuestion = questions[lastIdx + 1];
        }
      }

      return ok(res, { 
        session_id: session.id, 
        is_continuing: true,
        condition_category: category.rows[0]?.condition_category,
        next_question: nextQuestion,
        message: 'You have an unfinished triage. Continuing...'
      });
    }

    const condition_category = detectCategory(chief_complaint);

    const result = await pool.query(
      `INSERT INTO triage_sessions (patient_id, chief_complaint, condition_category, language, status)
       VALUES ($1, $2, $3, $4, 'in_progress') RETURNING *`,
      [user.patientId, chief_complaint, condition_category, language]
    );

    const session = result.rows[0];
    const questions = QUESTION_BANK[condition_category];
    const firstQuestion = questions[0];

    logger.info('Triage started', { sessionId: session.id, category: condition_category });

    return ok(res, { 
      session_id: session.id, 
      condition_category,
      first_question: firstQuestion
    });
  } catch (error) {
    logger.error('Start triage failed', { error });
    return err(res, 'Failed to start triage', 500);
  }
};

export const answerTriage = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { session_id, question_key, response_text, response_value } = req.body;

    const sessionResult = await pool.query('SELECT * FROM triage_sessions WHERE id = $1', [session_id]);
    if (sessionResult.rows.length === 0) {
      return err(res, 'Session not found', 404);
    }

    const session = sessionResult.rows[0];
    if (session.patient_id !== user.patientId) {
      return err(res, 'Forbidden', 403);
    }

    const is_emergency = detectEmergency(response_text || '');

    const responseCount = await pool.query(
      'SELECT COUNT(*) as count FROM triage_responses WHERE triage_session_id = $1',
      [session_id]
    );
    const response_order = parseInt(responseCount.rows[0].count) + 1;

    const questions = QUESTION_BANK[session.condition_category || 'general'];
    const currentQuestion = questions.find(q => q.key === question_key);
    const currentIdx = questions.findIndex(q => q.key === question_key);
    const nextQuestion = currentIdx >= 0 && currentIdx < questions.length - 1 ? questions[currentIdx + 1] : null;

    await pool.query(
      `INSERT INTO triage_responses (triage_session_id, question_key, question_text, response_text, response_value, is_emergency_flag, response_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [session_id, question_key, currentQuestion?.text_en, response_text, JSON.stringify(response_value), is_emergency, response_order]
    );

    if (is_emergency) {
      await pool.query(
        `UPDATE triage_sessions SET urgency_level = 'emergency', status = 'completed', completed_at = NOW() WHERE id = $1`,
        [session_id]
      );
      return ok(res, { is_emergency: true, is_complete: true, message: 'Emergency detected. Seeking immediate care recommended.' });
    }

    if (!nextQuestion) {
      const responses = await pool.query(
        `SELECT question_key, response_text FROM triage_responses WHERE triage_session_id = $1 ORDER BY response_order`,
        [session_id]
      );

      const summary = `Patient presents with ${session.chief_complaint}. Condition category: ${session.condition_category}. ${responses.rows.length} responses collected.`;

      await pool.query(
        `UPDATE triage_sessions SET status = 'completed', completed_at = NOW(), ai_summary = $1, urgency_level = 'routine'
         WHERE id = $2`,
        [summary, session_id]
      );

      return ok(res, { is_complete: true, summary });
    }

    return ok(res, { 
      next_question: nextQuestion,
      is_complete: false,
      is_emergency: false
    });
  } catch (error) {
    logger.error('Answer triage failed', { error });
    return err(res, 'Failed to process answer', 500);
  }
};

export const getTriageSummary = async (req: Request, res: Response) => {
  try {
    const { session_id } = req.params;

    const sessionResult = await pool.query('SELECT * FROM triage_sessions WHERE id = $1', [session_id]);
    if (sessionResult.rows.length === 0) {
      return err(res, 'Session not found', 404);
    }

    const responses = await pool.query(
      'SELECT * FROM triage_responses WHERE triage_session_id = $1 ORDER BY response_order',
      [session_id]
    );

    return ok(res, {
      ...sessionResult.rows[0],
      responses: responses.rows,
      completed_at: sessionResult.rows[0].completed_at
    });
  } catch (error) {
    logger.error('Get summary failed', { error });
    return err(res, 'Failed to get summary', 500);
  }
};

export const getTriageHistory = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { patient_id } = req.params;
    const { limit = 10, offset = 0 } = req.query;

    if (user.patientId !== patient_id && user.role !== 'doctor') {
      return err(res, 'Forbidden', 403);
    }

    const result = await pool.query(
      `SELECT id, chief_complaint, condition_category, urgency_level, status, started_at, completed_at 
       FROM triage_sessions WHERE patient_id = $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3`,
      [patient_id, limit, offset]
    );

    return ok(res, { sessions: result.rows, total: result.rows.length });
  } catch (error) {
    logger.error('Get history failed', { error });
    return err(res, 'Failed to get history', 500);
  }
};

export const getQuestions = async (req: Request, res: Response) => {
  try {
    const { condition_category } = req.query;
    
    if (!condition_category || !QUESTION_BANK[condition_category as string]) {
      return err(res, 'Invalid category', 400);
    }

    return ok(res, { questions: QUESTION_BANK[condition_category as string] });
  } catch (error) {
    logger.error('Get questions failed', { error });
    return err(res, 'Failed to get questions', 500);
  }
};

export const abandonTriage = async (req: Request, res: Response) => {
  try {
    const { session_id } = req.params;

    await pool.query(
      `UPDATE triage_sessions SET status = 'abandoned' WHERE id = $1`,
      [session_id]
    );

    return ok(res, { message: 'Triage session abandoned' });
  } catch (error) {
    logger.error('Abandon triage failed', { error });
    return err(res, 'Failed to abandon', 500);
  }
};

export const getActiveSession = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user.patientId) return err(res, 'Patient not found', 404);

    const result = await pool.query(
      `SELECT * FROM triage_sessions WHERE patient_id = $1 AND status = 'in_progress' AND started_at > NOW() - INTERVAL '24 hours'`,
      [user.patientId]
    );

    return ok(res, { session: result.rows[0] || null });
  } catch (error) {
    logger.error('Get active session failed', { error });
    return err(res, 'Failed to get active session', 500);
  }
};
