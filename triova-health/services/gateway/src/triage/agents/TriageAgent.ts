export interface TriageQuestion {
  key: string;
  text_en: string;
  text_hi?: string;
  type: 'text' | 'yes_no' | 'scale' | 'choice' | 'duration';
  is_critical?: boolean;
  choices?: string[];
}

export const QUESTION_BANK: Record<string, TriageQuestion[]> = {
  diabetes: [
    { key: 'glucose', text_en: 'What was your fasting blood sugar reading this morning?', type: 'text' },
    { key: 'hypo', text_en: 'Did you experience any dizziness, sweating, or shakiness that felt like low sugar?', type: 'yes_no' },
    { key: 'diet', text_en: 'How well did you follow your diabetes diet plan this week (1-10)?', type: 'scale' },
    { key: 'medication', text_en: 'Did you take all your diabetes medications on time this week?', type: 'yes_no' },
    { key: 'foot', text_en: 'Any tingling, numbness, or pain in your feet or legs?', type: 'yes_no' },
  ],
  hypertension: [
    { key: 'bp_reading', text_en: 'What was your most recent blood pressure reading?', type: 'text' },
    { key: 'headache', text_en: 'Did you have any headaches, especially at the back of your head?', type: 'yes_no' },
    { key: 'medication', text_en: 'Did you take your blood pressure medication every day without missing a dose?', type: 'yes_no' },
    { key: 'salt', text_en: 'How would you rate your salt intake this week (Low/Moderate/High)?', type: 'choice', choices: ['Low', 'Moderate', 'High'] },
    { key: 'vision', text_en: 'Any blurred vision or chest discomfort this week?', type: 'yes_no' },
  ],
  copd: [
    { key: 'breathlessness', text_en: 'On a scale of 1 to 10, how much breathlessness did you feel doing daily activities?', type: 'scale' },
    { key: 'inhaler', text_en: 'How many times did you need to use your rescue inhaler this week?', type: 'text' },
    { key: 'spo2', text_en: 'What was your most recent oxygen (SpO2) reading?', type: 'text' },
    { key: 'cough', text_en: 'Has your cough gotten worse or the mucus color changed?', type: 'yes_no' },
    { key: 'sleep', text_en: 'Could you sleep lying flat, or did you need extra pillows for breathing?', type: 'yes_no' },
  ],
  heart_failure: [
    { key: 'weight', text_en: 'What is your weight today? Any sudden gain (>1kg in a day)?', type: 'text' },
    { key: 'swelling', text_en: 'Any swelling in your ankles, feet, or legs?', type: 'yes_no' },
    { key: 'fatigue', text_en: 'How much fatigue did you feel doing simple tasks like walking (1-10)?', type: 'scale' },
    { key: 'orthopnea', text_en: 'Did you wake up at night feeling breathless or need more pillows?', type: 'yes_no' },
    { key: 'medication', text_en: 'Did you take all your heart medications, including water pills, every day?', type: 'yes_no' },
  ],
  general: [
    { key: 'main_complaint', text_en: 'Describe your main problem in your own words', type: 'text' },
    { key: 'duration', text_en: 'How long have you been experiencing this?', type: 'duration' },
    { key: 'severity', text_en: 'On a scale of 1 to 10, how much is this affecting daily life?', type: 'scale' },
    {
      key: 'getting_worse',
      text_en: 'Is it getting better, worse, or the same?',
      type: 'choice',
      choices: ['Getting better', 'Getting worse', 'Same', 'Comes and goes'],
    },
    { key: 'current_medications', text_en: 'Current medications?', type: 'text' },
    { key: 'allergies', text_en: 'Known allergies?', type: 'text' },
    { key: 'similar_episodes', text_en: 'Have you had this before? How treated?', type: 'text' },
  ],
};

export function classifyCategory(chief: string): keyof typeof QUESTION_BANK {
  const t = chief.toLowerCase();
  if (
    /chest|heart|palpitation|cardiac/.test(t) ||
    (t.includes('shortness') && t.includes('breath'))
  )
    return 'heart';
  if (/breath|cough|asthma|wheeze|copd|lung/.test(t)) return 'respiratory';
  if (/stomach|nausea|vomit|diarrh|abdomen|digest/.test(t)) return 'digestive';
  if (/headache|dizz|seizure|numb|vision|neuro/.test(t)) return 'neurological';
  return 'general';
}
