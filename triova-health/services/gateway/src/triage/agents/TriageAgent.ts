export interface TriageQuestion {
  key: string;
  text_en: string;
  text_hi?: string;
  type: 'text' | 'yes_no' | 'scale' | 'choice' | 'duration';
  is_critical?: boolean;
  choices?: string[];
}

export const QUESTION_BANK: Record<string, TriageQuestion[]> = {
  heart: [
    { key: 'chest_pain', text_en: 'Are you experiencing chest pain or discomfort?', type: 'yes_no', is_critical: true },
    { key: 'pain_duration', text_en: 'How long have you had this chest pain?', type: 'duration' },
    { key: 'pain_radiation', text_en: 'Does the pain spread to your arm, jaw, neck, or back?', type: 'yes_no', is_critical: true },
    { key: 'shortness_of_breath', text_en: 'Are you short of breath?', type: 'yes_no', is_critical: true },
    { key: 'sweating_nausea', text_en: 'Are you sweating or feeling nauseous?', type: 'yes_no' },
    { key: 'heart_history', text_en: 'Do you have a history of heart disease or heart attack?', type: 'yes_no' },
    { key: 'current_medications', text_en: 'Are you taking any heart medications? If yes, which ones?', type: 'text' },
  ],
  respiratory: [
    { key: 'breathing_difficulty', text_en: 'Are you having difficulty breathing right now?', type: 'yes_no', is_critical: true },
    { key: 'breathing_severity', text_en: 'On a scale of 1 to 10, how severe is your breathing difficulty?', type: 'scale' },
    {
      key: 'cough_type',
      text_en: 'Do you have a cough? Is it dry or productive?',
      type: 'choice',
      choices: ['No cough', 'Dry cough', 'Wet/productive cough', 'Coughing blood'],
    },
    { key: 'onset_duration', text_en: 'When did your breathing problems start?', type: 'duration' },
    { key: 'fever', text_en: 'Do you have a fever?', type: 'yes_no' },
    { key: 'asthma_history', text_en: 'Do you have asthma, COPD, or chronic lung disease?', type: 'yes_no' },
    { key: 'inhaler_use', text_en: 'Have you used an inhaler or nebulizer? Did it help?', type: 'text' },
  ],
  digestive: [
    { key: 'pain_location', text_en: 'Where exactly is your stomach pain?', type: 'text' },
    { key: 'pain_severity', text_en: 'Rate your pain from 1 to 10', type: 'scale' },
    { key: 'nausea_vomiting', text_en: 'Are you experiencing nausea or vomiting?', type: 'yes_no' },
    { key: 'blood_in_stool', text_en: 'Any blood in stool or vomit?', type: 'yes_no', is_critical: true },
    { key: 'last_meal', text_en: 'When did you last eat, and what did you have?', type: 'text' },
  ],
  neurological: [
    { key: 'headache_severity', text_en: 'Rate headache 1–10. Worst headache of your life?', type: 'scale', is_critical: true },
    { key: 'sudden_onset', text_en: 'Did the headache come on suddenly (thunderclap)?', type: 'yes_no', is_critical: true },
    { key: 'vision_changes', text_en: 'Any vision changes or loss?', type: 'yes_no', is_critical: true },
    { key: 'weakness_numbness', text_en: 'Weakness or numbness in face, arm, or leg?', type: 'yes_no', is_critical: true },
    { key: 'speech_difficulty', text_en: 'Difficulty speaking?', type: 'yes_no', is_critical: true },
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
