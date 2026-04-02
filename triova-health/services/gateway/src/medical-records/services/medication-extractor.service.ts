import { getChatModel, getOpenAI, withOpenAIRetry } from '../../lib/openai.js';
import { pool } from '@triova/shared';
import { logger } from '@triova/shared';

export async function extractMedicationsFromPrescription(patientId: string, extractedText: string) {
  const openai = getOpenAI();
  if (!openai) {
    logger.warn('No AI client available for medication extraction');
    return;
  }
  if (!extractedText?.trim()) {
    logger.warn('No extracted text for medication extraction');
    return;
  }

  const completion = await withOpenAIRetry(() =>
    openai.chat.completions.create({
      model: getChatModel(),
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a medical prescription parser. Extract medication details from prescription text. 
Return ONLY valid JSON with this exact format:
{"medications": [{"medication_name": "string", "dosage": "string", "frequency": "string", "timing": "string", "duration_days": number, "instructions": "string"}]}

Guidelines:
- medication_name: The actual medicine name (e.g., "Amoxicillin", "Paracetamol")
- dosage: Amount per dose (e.g., "500mg", "10ml")
- frequency: How often per day (e.g., "twice daily", "three times a day", "once daily")
- timing: When to take (e.g., "after meals", "before food", "at night")
- duration_days: Number of days (e.g., 7, 14, 30) - estimate if not specified
- instructions: Special instructions (e.g., "take with water", "avoid alcohol")

Extract ALL medications found in the prescription. If none found, return {"medications": []}`
        },
        {
          role: 'user',
          content: `Extract all medications from this prescription:\n\n${extractedText.slice(0, 15000)}`
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
    logger.error('Failed to parse medication JSON');
    return;
  }

  logger.info(`Found ${meds.length} medications to insert`);

  for (const m of meds) {
    const name = String(m.medication_name || '').trim();
    if (!name) continue;
    
    const frequency = String(m.frequency || '');
    const timing = String(m.timing || m.instructions || '');
    const durationDays = Number(m.duration_days) || 7;
    
    const ins = await pool.query(
      `INSERT INTO patient_medications (patient_id, medication_name, dosage, frequency, timing_instructions, start_date, end_date, source)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, CURRENT_DATE + INTERVAL '${durationDays} days', 'prescription_scan') 
       RETURNING id`,
      [
        patientId,
        name,
        String(m.dosage || ''),
        frequency,
        timing,
      ]
    );
    const mid = ins.rows[0].id as string;
    
    const times = parseFrequencyToTimes(frequency);
    for (const time of times) {
      await pool.query(
        `INSERT INTO medication_reminders (patient_id, medication_id, reminder_time, is_active) 
         VALUES ($1, $2, $3, true)`,
        [patientId, mid, time]
      );
    }
    
    logger.info(`Added medication: ${name} with ${times.length} reminders`);
  }
}

function parseFrequencyToTimes(frequency: string): string[] {
  const freq = frequency.toLowerCase();
  if (freq.includes('once') || freq.includes('1 time') || freq.includes('once daily')) {
    return ['09:00:00'];
  } else if (freq.includes('twice') || freq.includes('2 times') || freq.includes('twice daily')) {
    return ['09:00:00', '21:00:00'];
  } else if (freq.includes('three') || freq.includes('3 times')) {
    return ['09:00:00', '14:00:00', '21:00:00'];
  } else if (freq.includes('four') || freq.includes('4 times')) {
    return ['08:00:00', '12:00:00', '16:00:00', '21:00:00'];
  }
  return ['09:00:00'];
}
