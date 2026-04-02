import { pool } from '@triova/shared';
import { getChatModel, getOpenAI, getTranscriptionModel, withOpenAIRetry } from '../../lib/openai.js';
import { QUESTION_BANK, classifyCategory, type TriageQuestion } from '../agents/TriageAgent.js';
import { detectEmergency } from '../agents/EmergencyDetector.js';
import { toFile } from 'openai/uploads';
import { saveTriageImage } from '../../lib/storage.js';
import { emitToUser } from '../../socket-server.js';

function getQuestionsForCategory(cat: string): TriageQuestion[] {
  return QUESTION_BANK[cat] || QUESTION_BANK.general;
}

export async function startTriage(patientId: string, chief_complaint: string, language: string) {
  const existing = await pool.query(
    `SELECT * FROM triage_sessions WHERE patient_id = $1 AND status = 'in_progress' AND started_at > NOW() - INTERVAL '24 hours' ORDER BY started_at DESC LIMIT 1`,
    [patientId]
  );
  if (existing.rows[0]) {
    const s = existing.rows[0];
    const qs = getQuestionsForCategory(s.condition_category || 'general');
    const ans = await pool.query(
      `SELECT COUNT(*)::int AS c FROM triage_responses WHERE triage_session_id = $1`,
      [s.id]
    );
    const idx = ans.rows[0].c;
    const next = qs[idx] || null;
    return {
      session_id: s.id,
      condition_category: s.condition_category,
      first_question: next,
      resumed: true,
    };
  }

  const category = classifyCategory(chief_complaint);
  const ins = await pool.query(
    `INSERT INTO triage_sessions (patient_id, status, language, chief_complaint, condition_category)
     VALUES ($1,'in_progress',$2,$3,$4) RETURNING *`,
    [patientId, language || 'en', chief_complaint, category]
  );
  const session = ins.rows[0];
  const qs = getQuestionsForCategory(category);
  const first = qs[0];
  return {
    session_id: session.id,
    condition_category: category,
    first_question: first,
  };
}

export async function answerTriage(
  patientId: string,
  session_id: string,
  question_key: string,
  response_text: string,
  response_value?: unknown
) {
  const sess = await pool.query(`SELECT * FROM triage_sessions WHERE id = $1 AND patient_id = $2`, [
    session_id,
    patientId,
  ]);
  if (!sess.rows[0]) throw Object.assign(new Error('Session not found'), { status: 404 });
  const s = sess.rows[0];
  if (s.status !== 'in_progress') throw Object.assign(new Error('Session closed'), { status: 400 });

  const emergency = detectEmergency(response_text);
  const qs = getQuestionsForCategory(s.condition_category || 'general');
  const qdef = qs.find((q) => q.key === question_key);
  const qtext = qdef?.text_en || question_key;

  const ordR = await pool.query(
    `SELECT COALESCE(MAX(response_order),0)+1 AS n FROM triage_responses WHERE triage_session_id = $1`,
    [session_id]
  );
  const response_order = ordR.rows[0].n;

  await pool.query(
    `INSERT INTO triage_responses (triage_session_id, question_key, question_text, response_text, response_value, is_emergency_flag, response_order)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [session_id, question_key, qtext, response_text, JSON.stringify(response_value ?? null), emergency, response_order]
  );

  if (emergency) {
    await pool.query(
      `UPDATE triage_sessions SET urgency_level = 'emergency', status = 'completed', completed_at = NOW(), ai_summary = $2, key_symptoms = $3, recommended_actions = $4 WHERE id = $1`,
      [
        session_id,
        'Emergency keywords detected — seek immediate care.',
        ['emergency_keyword'],
        ['Call emergency services or go to ER immediately'],
      ]
    );
    return { is_emergency: true, is_complete: true, summary: await getSummary(session_id) };
  }

  const nextIdx = response_order; // 1-based order → next question index = response_order (0-based: next is qs[response_order])
  const nextQ = qs[nextIdx];
  if (!nextQ) {
    await finalizeWithAI(s, session_id);
    return {
      is_emergency: false,
      is_complete: true,
      summary: await getSummary(session_id),
    };
  }
  return {
    next_question: nextQ,
    is_complete: false,
    is_emergency: false,
  };
}

async function finalizeWithAI(s: Record<string, unknown>, sessionId: string) {
  const res = await pool.query(
    `SELECT question_text, response_text FROM triage_responses WHERE triage_session_id = $1 ORDER BY response_order`,
    [sessionId]
  );
  const numbered = res.rows.map((r: { question_text: string; response_text: string }, i: number) => `${i + 1}. Q: ${r.question_text} A: ${r.response_text}`).join('\n');
  const openai = getOpenAI();
  if (!openai) {
    await pool.query(
      `UPDATE triage_sessions SET status = 'completed', completed_at = NOW(), urgency_level = 'routine', ai_summary = $2, key_symptoms = $3, recommended_actions = $4 WHERE id = $1`,
      [sessionId, 'Triage completed (AI unavailable)', [], ['Follow up with your doctor']]
    );
    return;
  }
  const completion = await withOpenAIRetry(() =>
    openai.chat.completions.create({
      model: getChatModel(),
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: `You are a medical triage assistant. Chief Complaint: ${s.chief_complaint}\nCategory: ${s.condition_category}\n${numbered}\n\nReturn JSON per TRIAGE spec: summary, key_symptoms[], relevant_history, recommended_actions[], urgency_level (EMERGENCY|URGENT|ROUTINE), urgency_reasoning.`,
        },
      ],
    })
  );
  const raw = completion.choices[0]?.message?.content || '{}';
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* */
  }
  const urg = String(parsed.urgency_level || 'routine').toLowerCase();
  const urgency = urg.includes('emergency') ? 'emergency' : urg.includes('urgent') ? 'urgent' : 'routine';
  await pool.query(
    `UPDATE triage_sessions SET status = 'completed', completed_at = NOW(), urgency_level = $2::urgency_level, ai_summary = $3, key_symptoms = $4, recommended_actions = $5 WHERE id = $1`,
    [
      sessionId,
      urgency,
      String(parsed.summary || ''),
      (parsed.key_symptoms as string[]) || [],
      (parsed.recommended_actions as string[]) || [],
    ]
  );
}

async function getSummary(sessionId: string) {
  const r = await pool.query(`SELECT * FROM triage_sessions WHERE id = $1`, [sessionId]);
  return r.rows[0];
}

export async function getTriageSummary(sessionId: string) {
  const r = await pool.query(`SELECT * FROM triage_sessions WHERE id = $1`, [sessionId]);
  if (!r.rows[0]) throw Object.assign(new Error('Not found'), { status: 404 });
  const responses = await pool.query(`SELECT * FROM triage_responses WHERE triage_session_id = $1 ORDER BY response_order`, [sessionId]);
  return { ...r.rows[0], responses: responses.rows };
}

export async function triageHistory(patientId: string, limit = 20, offset = 0) {
  const r = await pool.query(
    `SELECT * FROM triage_sessions WHERE patient_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [patientId, limit, offset]
  );
  const c = await pool.query(`SELECT COUNT(*)::int AS n FROM triage_sessions WHERE patient_id = $1`, [patientId]);
  return { sessions: r.rows, total: c.rows[0].n };
}

export async function listQuestions(category: string) {
  return { questions: getQuestionsForCategory(category) };
}

export async function abandon(sessionId: string, patientId: string) {
  await pool.query(`UPDATE triage_sessions SET status = 'abandoned' WHERE id = $1 AND patient_id = $2`, [
    sessionId,
    patientId,
  ]);
  return { message: 'Abandoned' };
}

export async function activeSession(patientId: string) {
  const r = await pool.query(
    `SELECT * FROM triage_sessions WHERE patient_id = $1 AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1`,
    [patientId]
  );
  return { session: r.rows[0] || null };
}

export async function voiceAnswer(patientId: string, session_id: string, audio_base64: string) {
  const openai = getOpenAI();
  if (!openai) {
    return {
      transcription: '',
      error: 'ai_service_unavailable',
      fallback: 'text_input',
    };
  }
  const buf = Buffer.from(audio_base64, 'base64');
  if (buf.length < 100) {
    return { success: false, error: 'audio_quality', fallback: 'text_input' };
  }
  const file = await toFile(buf, 'audio.webm', { type: 'audio/webm' });
  const tr = await withOpenAIRetry(() =>
    openai.audio.transcriptions.create({ file, model: getTranscriptionModel() })
  );
  const transcription = tr.text || '';
  const words = transcription.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) {
    return { transcription, success: false, error: 'audio_quality', fallback: 'text_input' };
  }
  const sess = await pool.query(`SELECT * FROM triage_sessions WHERE id = $1 AND patient_id = $2`, [
    session_id,
    patientId,
  ]);
  if (!sess.rows[0]) throw Object.assign(new Error('Not found'), { status: 404 });
  const s = sess.rows[0];
  const qs = getQuestionsForCategory(s.condition_category || 'general');
  const ans = await pool.query(
    `SELECT COUNT(*)::int AS c FROM triage_responses WHERE triage_session_id = $1`,
    [session_id]
  );
  const idx = ans.rows[0].c;
  const q = qs[idx];
  if (!q) {
    await finalizeWithAI(s, session_id);
    return { transcription, is_complete: true, summary: await getSummary(session_id) };
  }
  return answerTriage(patientId, session_id, q.key, transcription);
}

export async function uploadImage(patientId: string, session_id: string, buffer: Buffer, mimetype: string) {
  const sess = await pool.query(`SELECT * FROM triage_sessions WHERE id = $1 AND patient_id = $2`, [
    session_id,
    patientId,
  ]);
  if (!sess.rows[0]) throw Object.assign(new Error('Not found'), { status: 404 });
  const ext = mimetype.includes('png') ? 'png' : 'jpg';
  const { fileUrl } = await saveTriageImage(session_id, buffer, ext);
  let analysis = '';
  const openai = getOpenAI();
  if (openai) {
    const b64 = buffer.toString('base64');
    const completion = await withOpenAIRetry(() =>
      openai.chat.completions.create({
        model: getChatModel(),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe clinical findings for triage (no diagnosis):' },
              { type: 'image_url', image_url: { url: `data:${mimetype};base64,${b64}` } },
            ],
          },
        ],
        max_tokens: 400,
      })
    );
    analysis = completion.choices[0]?.message?.content || '';
  }
  const img = await pool.query(
    `INSERT INTO triage_images (triage_session_id, image_url, ai_analysis) VALUES ($1,$2,$3) RETURNING id`,
    [session_id, fileUrl, analysis]
  );
  return { image_id: img.rows[0].id, ai_analysis: analysis };
}

export async function notifyDoctorTriage(doctorUserId: string, sessionId: string, preview: string) {
  emitToUser(doctorUserId, 'triage_received', { session_id: sessionId, summary_preview: preview });
}
