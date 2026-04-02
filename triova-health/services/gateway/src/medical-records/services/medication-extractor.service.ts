import { getChatModel, getOpenAI, withOpenAIRetry } from '../../lib/openai.js';
import { pool } from '@triova/shared';

export async function extractMedicationsFromPrescription(patientId: string, extractedText: string) {
  const openai = getOpenAI();
  if (!openai || !extractedText?.trim()) return;
  const completion = await withOpenAIRetry(() =>
    openai.chat.completions.create({
      model: getChatModel(),
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: `Extract medications JSON array from:\n${extractedText.slice(0, 12000)}\n\nReturn { "medications": [...] } with items medication_name, dosage, frequency, timing, duration_days, instructions`,
        },
      ],
    })
  );
  const raw = completion.choices[0]?.message?.content || '{"medications":[]}';
  let meds: Array<Record<string, unknown>> = [];
  try {
    const p = JSON.parse(raw) as { medications?: Array<Record<string, unknown>> };
    meds = p.medications || [];
  } catch {
    return;
  }
  for (const m of meds) {
    const name = String(m.medication_name || '').trim();
    if (!name) continue;
    const ins = await pool.query(
      `INSERT INTO patient_medications (patient_id, medication_name, dosage, frequency, timing_instructions, start_date, source)
       VALUES ($1,$2,$3,$4,$5, CURRENT_DATE, 'prescription_scan') RETURNING id`,
      [
        patientId,
        name,
        String(m.dosage || ''),
        String(m.frequency || ''),
        String(m.timing || m.instructions || ''),
      ]
    );
    const mid = ins.rows[0].id as string;
    await pool.query(
      `INSERT INTO medication_reminders (patient_id, medication_id, reminder_time) VALUES ($1,$2,'09:00:00')`,
      [patientId, mid]
    );
  }
}
