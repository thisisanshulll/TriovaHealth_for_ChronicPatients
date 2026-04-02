import { pool } from '@triova/shared';
import { getChatModel, getOpenAI, getTranscriptionModel, withOpenAIRetry } from '../../lib/openai.js';
import { QUESTION_BANK, classifyCategory, type TriageQuestion } from '../agents/TriageAgent.js';
import { detectEmergency } from '../agents/EmergencyDetector.js';
import { toFile } from 'openai/uploads';
import { saveTriageImage } from '../../lib/storage.js';
import { emitToUser, emitToDoctorDashboard } from '../../socket-server.js';

function getQuestionsForCategory(cat: string): TriageQuestion[] {
  return QUESTION_BANK[cat] || QUESTION_BANK.general;
}

export async function startTriage(patientId: string, chief_complaint: string, language: string, condition_category?: string) {
  const category = condition_category || classifyCategory(chief_complaint);
  const langVal = language || 'en';

  const existing = await pool.query(
    `SELECT * FROM triage_sessions WHERE patient_id = $1 AND status = 'in_progress' AND started_at > NOW() - INTERVAL '24 hours' ORDER BY started_at DESC LIMIT 1`,
    [patientId]
  );
  if (existing.rows[0]) {
    const s = existing.rows[0];
    // If language or condition category changed, abandon this old session instead of forcing a resume.
    if (s.language !== langVal || s.condition_category !== category) {
      await pool.query(`UPDATE triage_sessions SET status = 'abandoned' WHERE id = $1`, [s.id]);
      // Will bypass the return and fall through to creating a new session
    } else {
      // Find the last unanswered AI question in the conversation to resume smoothly
      const lastR = await pool.query(
        `SELECT question_text, response_text FROM triage_responses WHERE triage_session_id = $1 ORDER BY response_order DESC LIMIT 1`,
        [s.id]
      );
      
      let firstQ;
      if (lastR.rows.length > 0 && lastR.rows[0].response_text === null) {
        const txt = lastR.rows[0].question_text;
        firstQ = { id: 'resume_q', en: txt, hi: txt };
      } else {
        const qs = getQuestionsForCategory(s.condition_category || 'general');
        const ans = await pool.query(`SELECT COUNT(*)::int AS c FROM triage_responses WHERE triage_session_id = $1`, [s.id]);
        firstQ = qs[ans.rows[0].c] || { id: 'dynamic_start', en: 'Please continue.', hi: 'कृपया जारी रखें।' };
      }

      return {
        session_id: s.id,
        condition_category: s.condition_category,
        first_question: firstQ,
        resumed: true,
      };
    }
  }

  const ins = await pool.query(
    `INSERT INTO triage_sessions (patient_id, status, language, chief_complaint, condition_category)
     VALUES ($1,'in_progress',$2,$3,$4) RETURNING *`,
    [patientId, language || 'en', chief_complaint, category]
  );
  const session = ins.rows[0];
  // Setup first dynamic question
  const qs = getQuestionsForCategory(category);
  const firstProtocolParams = qs.map(q => q.text_en).join(', ');

  const openai = getOpenAI();
  const langPrompt = language === 'hi' ? 'Hindi (Devanagari script only)' : 'English';
  
  let firstReply = language === 'hi' ? 'नमस्ते! आपका साप्ताहिक चेक-इन कैसा जा रहा है?' : 'Hello! I am your AI assistant. How are you feeling this week?';

  if (openai) {
      try {
          const c = await withOpenAIRetry(() => openai.chat.completions.create({
            model: getChatModel(),
            temperature: 0.3,
            messages: [{
                role: 'system',
                content: `You are a clinical triage assistant conducting a WEEKLY REVIEW for a known chronic patient. 
Protocol Category: ${category}
Language: ${langPrompt}
Key items to collect: ${firstProtocolParams}

Guidelines:
1. Acknowledge this is a regular weekly check-in (e.g., "how have your readings been this week?").
2. Ask the FIRST protocol question naturally but concisely.
3. Your tone must be clinical, professional, and empathetic.`
            }]
          }));
          firstReply = c.choices[0]?.message?.content || firstReply;
      } catch(e) {}
  }

  await pool.query(
    `INSERT INTO triage_responses (triage_session_id, question_key, question_text, response_text, response_order)
     VALUES ($1,$2,$3,null,1)`,
    [session.id, 'dynamic_start', firstReply]
  );

  return {
    session_id: session.id,
    condition_category: category,
    first_question: { id: 'dynamic_start', en: firstReply, hi: firstReply },
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
  
  // 1. Get history
  const historyR = await pool.query(
    `SELECT id, question_text, response_text FROM triage_responses WHERE triage_session_id = $1 ORDER BY response_order`,
    [session_id]
  );
  
  const protocolQs = getQuestionsForCategory(s.condition_category || 'general').map(q => q.text_en).join('\n- ');

  if (historyR.rows.length > 0) {
     // Find the most recent response-less question to fill
     const lastRow = historyR.rows[historyR.rows.length - 1];
     if (lastRow.response_text === null) {
         await pool.query(`UPDATE triage_responses SET response_text = $1 WHERE id = $2`, [response_text, lastRow.id]);
         lastRow.response_text = response_text; // Update local copy
     }
  }

  // Build conversation context for LLM
  const conversation = historyR.rows
    .map(r => `AI: ${r.question_text}\nPatient: ${r.response_text || ''}`)
    .join('\n\n');

  const lang = s.language === 'hi' ? 'Hindi (Devanagari script only)' : 'English';

  const isExhaustive = historyR.rows.length > 15;
  if (isExhaustive) {
      const finishMsg = s.language === 'hi' ? 'धन्यवाद, हमारे पास पर्याप्त जानकारी है।' : 'Thank you, we have all the necessary information.';
      return { is_emergency: false, is_complete: true, next_question: { id: 'done', en: finishMsg, hi: finishMsg } };
  }

  const openai = getOpenAI();
  if (!openai) {
      console.error('getOpenAI() returned null. Check GROQ_API_KEY in .env');
      throw new Error('AI Service not initialized');
  }

  let completion;
  try {
    completion = await withOpenAIRetry(() =>
      openai.chat.completions.create({
      model: getChatModel(),
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a clinical AI triage assistant conducting a WEEKLY clinical check-in for a KNOWN CHRONIC patient: ${s.condition_category}.
Language: ${lang}. 
If language is Hindi, you MUST reply in pure Devanagari script. DO NOT use English letters.

Your goal is to collect this week's data for: ${s.condition_category}.
Checklist protocol:
- ${protocolQs}

Strict Instructions:
1. Use concise, professional phrasing.
2. If they give a vague answer, acknowledge it but insist on the specific metric (numbers, yes/no).
3. Do NOT act like you are meeting them for the first time.
4. IMPORTANT: Compare the patient's answers in the conversation history against the Checklist protocol.
5. If ANY checklist item has NOT been answered yet, ask about it and set "is_complete": false.
6. If ALL checklist items HAVE been answered by the patient, set "is_complete": true and say a brief professional goodbye in "ai_reply".

Output strictly JSON:
{
  "ai_reply": "Your next question, or goodbye message if complete",
  "missing_protocols": ["list of items still not answered, empty if all answered"],
  "is_complete": boolean
}`
        },
        {
          role: 'user',
          content: conversation
        }
      ]
      })
    );
  } catch (err: any) {
    console.error('Groq AI API Call Error:', err.message || err);
    throw err;
  }

  const raw = completion.choices[0]?.message?.content || '{}';
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch(e) {}

  const aiReply = parsed.ai_reply || (s.language === 'hi' ? 'कृपया अपनी बात स्पष्ट करें।' : 'Please clarify your response.');
  const isComplete = parsed.is_complete === true;

  // Insert the AI's NEW question into the database, waiting for the patient's next response
  const ordR = await pool.query(
    `SELECT COALESCE(MAX(response_order),0)+1 AS n FROM triage_responses WHERE triage_session_id = $1`,
    [session_id]
  );
  const response_order = ordR.rows[0].n;

  await pool.query(
    `INSERT INTO triage_responses (triage_session_id, question_key, question_text, response_text, is_emergency_flag, response_order)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [session_id, 'dynamic_q', aiReply, null, emergency, response_order]
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
    return { is_emergency: true, is_complete: true, next_question: { id: 'dynamic', en: aiReply, hi: aiReply } };
  }

  if (isComplete) {
      // Don't call finalizeWithAI here, frontend will call generate-summary which does it
      return { is_emergency: false, is_complete: true, next_question: { id: 'dynamic', en: aiReply, hi: aiReply } };
  }

  return {
    next_question: { id: 'dynamic_q', en: aiReply, hi: aiReply },
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

export async function generateSoapSummary(sessionId: string, patientId: string) {
  const sessR = await pool.query(
    `SELECT ts.*, p.first_name, p.last_name
     FROM triage_sessions ts
     JOIN patients p ON p.id = ts.patient_id
     WHERE ts.id = $1 AND ts.patient_id = $2`,
    [sessionId, patientId]
  );
  if (!sessR.rows[0]) throw Object.assign(new Error('Session not found'), { status: 404 });
  const s = sessR.rows[0];

  const respR = await pool.query(
    `SELECT question_text, response_text FROM triage_responses WHERE triage_session_id = $1 ORDER BY response_order`,
    [sessionId]
  );
  const conversation = respR.rows
    .map((r: { question_text: string; response_text: string }, i: number) =>
      `Q${i + 1}: ${r.question_text}\nA: ${r.response_text}`
    )
    .join('\n\n');

  const patientName = `${s.first_name} ${s.last_name}`;
  const disease = s.condition_category || 'general';

  const openai = getOpenAI();
  let parsed: Record<string, unknown> = {
    soap: {
      subjective: 'Patient completed triage check-in.',
      objective: 'Vitals and symptoms reported via smartwatch and AI triage.',
      assessment: 'Patient-reported data collected. Requires physician review.',
      plan: 'Schedule follow-up with assigned doctor.',
    },
    risk_level: 'MODERATE',
    key_concerns: ['Review triage responses'],
    doctor_recommendation: 'Review triage report and schedule follow-up if needed.',
  };

  if (openai) {
    try {
      const completion = await withOpenAIRetry(() =>
        openai.chat.completions.create({
          model: getChatModel(),
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `You are a clinical AI assistant generating a weekly triage summary for a doctor.
Patient: ${patientName}
Disease: ${disease}

Based on the triage conversation below, generate a structured clinical summary.
Output ONLY valid JSON with this exact shape:
{
  "soap": { "subjective": string, "objective": string, "assessment": string, "plan": string },
  "risk_level": "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
  "key_concerns": string[],
  "doctor_recommendation": string
}
Be concise, clinical, and factual. Never fabricate data not present in the conversation.`,
            },
            {
              role: 'user',
              content: conversation,
            },
          ],
        })
      );
      const raw = completion.choices[0]?.message?.content || '{}';
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      /* Use fallback above */
    }
  }

  const riskLevel = String(parsed.risk_level || 'MODERATE').toUpperCase();
  const urg = riskLevel === 'CRITICAL' || riskLevel === 'HIGH'
    ? 'emergency'
    : riskLevel === 'MODERATE'
    ? 'urgent'
    : 'routine';

  const soapText = JSON.stringify(parsed.soap || {});
  const keyConcerns = (parsed.key_concerns as string[]) || [];
  const doctorRec = String(parsed.doctor_recommendation || '');

  await pool.query(
    `UPDATE triage_sessions SET status = 'completed', completed_at = NOW(),
     urgency_level = $2::urgency_level, ai_summary = $3,
     key_symptoms = $4, recommended_actions = $5
     WHERE id = $1`,
    [sessionId, urg, soapText, keyConcerns, [doctorRec]]
  );

  // Notify assigned doctor via Socket.IO
  const assignR = await pool.query(
    `SELECT dpa.doctor_id, d.user_id as doctor_user_id
     FROM doctor_patient_assignments dpa
     JOIN doctors d ON d.id = dpa.doctor_id
     WHERE dpa.patient_id = $1
     LIMIT 1`,
    [patientId]
  );

  const payload = {
    session_id: sessionId,
    patient_id: patientId,
    patient_name: patientName,
    disease,
    risk_level: riskLevel,
    key_concerns: keyConcerns,
    doctor_recommendation: doctorRec,
    soap: parsed.soap,
    completed_at: new Date().toISOString(),
  };

  if (assignR.rows[0]) {
    const { doctor_id, doctor_user_id } = assignR.rows[0];
    emitToDoctorDashboard(doctor_id, 'triage_summary_ready', payload);
    emitToUser(doctor_user_id, 'triage_summary_ready', payload);
  }

  return payload;
}
