import { toFile } from 'openai/uploads';
import { getChatModel, getOpenAI, getTranscriptionModel, withOpenAIRetry } from '../../lib/openai.js';
import { pool } from '@triova/shared';

export interface VoiceBookingResult {
  transcription: string;
  extracted_details: {
    date?: string;
    time?: string;
    urgency?: string;
    chief_complaint?: string;
  };
  available_slots: { time: string; is_available: boolean; remaining_count: number }[];
  suggested_appointment?: { doctor_id: string; date: string; time: string; urgency: string };
  alternatives?: { date: string; time: string }[];
  needs_clarification?: boolean;
  clarification_prompt?: string;
  confirmation_text?: string;
}

function parseJsonSafe(s: string): Record<string, unknown> {
  try {
    const m = s.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function runVoiceBooking(
  audioBase64: string,
  doctorId: string,
  patientId: string
): Promise<VoiceBookingResult> {
  const openai = getOpenAI();
  if (!openai) {
    return {
      transcription: '(AI provider not configured)',
      extracted_details: {},
      available_slots: [],
      confirmation_text: 'Configure GROQ_API_KEY (or OPENAI_API_KEY) for voice booking.',
    };
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const file = await toFile(audioBuffer, 'audio.webm', { type: 'audio/webm' });
  const tr = await withOpenAIRetry(() =>
    openai.audio.transcriptions.create({
      file,
      model: getTranscriptionModel(),
    })
  );
  const transcription = tr.text || '';

  const ctx = new Date().toISOString();
  const completion = await withOpenAIRetry(() =>
    openai.chat.completions.create({
      model: getChatModel(),
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You extract appointment booking intent. Current datetime context: ${ctx}. Return JSON: { "date": "YYYY-MM-DD or null", "time": "HH:MM:SS or null", "urgency": "emergency|urgent|routine", "chief_complaint": "string", "needs_clarification": boolean, "clarification_prompt": "string or null" }. Map evening to 18:00, morning 09:00, afternoon 14:00.`,
        },
        { role: 'user', content: transcription },
      ],
    })
  );
  const raw = completion.choices[0]?.message?.content || '{}';
  const ext = parseJsonSafe(raw);
  const date = typeof ext.date === 'string' ? ext.date : undefined;
  const time = typeof ext.time === 'string' ? ext.time : undefined;
  const urgency = typeof ext.urgency === 'string' ? ext.urgency : 'routine';

  const slots = await getSlotsForDate(doctorId, date || new Date().toISOString().slice(0, 10));

  let suggested: VoiceBookingResult['suggested_appointment'];
  const first = slots.find((s) => s.is_available);
  if (first && date) {
    suggested = { doctor_id: doctorId, date, time: first.time, urgency };
  }

  const alternatives = slots.filter((s) => s.is_available).slice(0, 3).map((s) => ({
    date: date || new Date().toISOString().slice(0, 10),
    time: s.time,
  }));

  return {
    transcription,
    extracted_details: {
      date,
      time,
      urgency,
      chief_complaint: typeof ext.chief_complaint === 'string' ? ext.chief_complaint : transcription,
    },
    available_slots: slots,
    suggested_appointment: suggested,
    alternatives,
    needs_clarification: ext.needs_clarification === true,
    clarification_prompt: typeof ext.clarification_prompt === 'string' ? ext.clarification_prompt : undefined,
    confirmation_text: suggested
      ? `Proposed appointment on ${suggested.date} at ${suggested.time}`
      : 'Please pick an available slot.',
  };
}

async function getSlotsForDate(doctorId: string, dateStr: string) {
  const r = await pool.query(
    `SELECT appointment_time::text, status FROM appointments
     WHERE doctor_id = $1 AND appointment_date = $2::date AND status NOT IN ('cancelled','no_show')`,
    [doctorId, dateStr]
  );
  const taken = new Set(r.rows.map((x: { appointment_time: string }) => x.appointment_time.slice(0, 8)));
  const out: { time: string; is_available: boolean; remaining_count: number }[] = [];
  for (let h = 9; h <= 16; h++) {
    for (const m of [0, 30]) {
      const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
      const avail = !taken.has(t.slice(0, 8));
      out.push({ time: t, is_available: avail, remaining_count: avail ? 1 : 0 });
    }
  }
  return out;
}
