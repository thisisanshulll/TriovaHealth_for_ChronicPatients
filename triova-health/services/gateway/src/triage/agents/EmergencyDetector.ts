const EMERGENCY_KEYWORDS = [
  "chest pain",
  "can't breathe",
  'can not breathe',
  'heart attack',
  'stroke',
  'unconscious',
  'passed out',
  'bleeding heavily',
  'blood',
  'suicide',
  'kill myself',
  'severe pain',
  'worst pain',
  'thunderclap',
  "can't speak",
  'face drooping',
  'arm weakness',
  'severe allergic',
  'anaphylaxis',
  'swallowed',
  'poisoned',
  'overdose',
];

export function detectEmergency(text: string): boolean {
  const t = text.toLowerCase();
  return EMERGENCY_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}
