import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Mic, MicOff, Send, Volume2, VolumeX } from 'lucide-react';
import { api } from '@/api/axios-instance';
import { useAuthStore } from '@/store/auth.store';
import { useSocket } from '@/hooks/useSocket';

// ─── Types ──────────────────────────────────────────────────────────────────

type Lang = 'en' | 'hi';

interface Question {
  id: string;
  en: string;
  hi: string;
  type: 'numeric' | 'boolean' | 'scale' | 'choice' | 'text';
  unit?: string;
  alert_above?: number;
  alert_below?: number;
  urgent_above?: number;
  options_en?: string[];
  options_hi?: string[];
}

interface QuestionBank {
  name_en: string;
  name_hi: string;
  questions: Question[];
}

interface ChatMessage {
  id: string;
  role: 'ai' | 'patient';
  content: string;
  timestamp: Date;
}

interface SoapSummary {
  risk_level: string;
  key_concerns: string[];
  doctor_recommendation: string;
  soap?: { subjective: string; objective: string; assessment: string; plan: string };
  patient_name?: string;
}

// ─── Question Banks ──────────────────────────────────────────────────────────

const QUESTION_BANKS: Record<string, QuestionBank> = {
  diabetes: {
    name_en: 'Diabetes Check-in',
    name_hi: 'मधुमेह जाँच',
    questions: [
      { id: 'glucose', en: "What was your fasting blood sugar reading this morning? Tell me the number.", hi: "आज सुबह आपका खाली पेट ब्लड शुगर कितना था? नंबर बताइए।", type: 'numeric', unit: 'mg/dL', alert_above: 180, urgent_above: 250 },
      { id: 'hypo', en: "Did you experience any dizziness, sweating, or shakiness yesterday that felt like low sugar?", hi: "क्या कल आपको चक्कर, पसीना या कंपकंपी हुई जो कम शुगर जैसी लगी?", type: 'boolean' },
      { id: 'diet', en: "On a scale of 1 to 10, how well did you follow your diet plan this week?", hi: "1 से 10 के पैमाने पर, इस हफ्ते आपने अपना डाइट प्लान कितना फॉलो किया?", type: 'scale' },
      { id: 'medication', en: "Did you take all your diabetes medications on time every day this week?", hi: "क्या इस हफ्ते आपने रोज समय पर अपनी सभी दवाइयाँ लीं?", type: 'boolean' },
      { id: 'foot', en: "Any tingling, numbness, or pain in your feet or legs this week?", hi: "क्या इस हफ्ते आपके पैरों में झनझनाहट, सुन्नपन या दर्द हुआ?", type: 'boolean' },
      { id: 'energy', en: "How would you rate your energy levels this week on a scale of 1 to 10?", hi: "इस हफ्ते आपकी ऊर्जा का स्तर 1 से 10 पर कैसा था?", type: 'scale' },
    ],
  },
  hypertension: {
    name_en: 'Blood Pressure Check-in',
    name_hi: 'ब्लड प्रेशर जाँच',
    questions: [
      { id: 'bp_reading', en: "Did you measure your blood pressure at home this week? If yes, what was the reading?", hi: "क्या आपने इस हफ्ते घर पर ब्लड प्रेशर नापा? अगर हाँ, तो रीडिंग क्या थी?", type: 'text' },
      { id: 'headache', en: "Did you have any headaches, especially in the morning or at the back of your head?", hi: "क्या आपको सिरदर्द हुआ, खासकर सुबह में या सिर के पिछले हिस्से में?", type: 'boolean' },
      { id: 'medication', en: "Did you take your blood pressure medication every day without missing a dose?", hi: "क्या आपने बिना कोई खुराक छोड़े हर रोज ब्लड प्रेशर की दवा ली?", type: 'boolean' },
      { id: 'salt', en: "How would you rate your salt intake this week — low, moderate, or high?", hi: "इस हफ्ते आपका नमक सेवन कैसा था — कम, मध्यम, या ज्यादा?", type: 'choice', options_en: ['Low', 'Moderate', 'High'], options_hi: ['कम', 'मध्यम', 'ज्यादा'] },
      { id: 'stress', en: "On a scale of 1 to 10, how stressed have you been this week?", hi: "1 से 10 पर, इस हफ्ते आप कितने तनाव में रहे?", type: 'scale' },
      { id: 'vision', en: "Any blurred vision or chest discomfort this week?", hi: "क्या इस हफ्ते धुंधला दिखा या सीने में कोई तकलीफ हुई?", type: 'boolean' },
    ],
  },
  copd: {
    name_en: 'Breathing Check-in',
    name_hi: 'सांस जाँच',
    questions: [
      { id: 'breathlessness', en: "On a scale of 1 to 10, how much breathlessness did you experience during daily activities this week?", hi: "1 से 10 पर, इस हफ्ते रोजमर्रा के कामों में आपको कितनी सांस फूली?", type: 'scale', alert_above: 6 },
      { id: 'inhaler', en: "How many times did you need to use your rescue inhaler this week?", hi: "इस हफ्ते आपने कितनी बार रेस्क्यू इनहेलर इस्तेमाल किया?", type: 'numeric', alert_above: 3 },
      { id: 'spo2', en: "Did you check your oxygen level with a pulse oximeter? What was the reading?", hi: "क्या आपने पल्स ऑक्सीमीटर से ऑक्सीजन लेवल चेक किया? रीडिंग क्या थी?", type: 'numeric', unit: '%', alert_below: 93 },
      { id: 'cough', en: "Has your cough gotten worse, or have you noticed any change in the color of mucus?", hi: "क्या आपकी खांसी बढ़ी है, या बलगम के रंग में कोई बदलाव आया?", type: 'boolean' },
      { id: 'sleep', en: "Were you able to sleep lying flat, or did you need extra pillows to breathe comfortably?", hi: "क्या आप सीधे लेटकर सो पाए, या सांस के लिए ज्यादा तकिए लगाने पड़े?", type: 'choice', options_en: ['Slept flat fine', 'Needed extra pillows', 'Could not lie flat'], options_hi: ['सीधे ठीक सोया', 'ज्यादा तकिए चाहिए थे', 'सीधे नहीं लेट सका'] },
    ],
  },
  heart_failure: {
    name_en: 'Heart Health Check-in',
    name_hi: 'हृदय स्वास्थ्य जाँच',
    questions: [
      { id: 'weight', en: "What is your weight today in kilograms? Sudden weight gain can signal fluid buildup.", hi: "आज आपका वजन कितने किलोग्राम है? अचानक वजन बढ़ना तरल जमाव का संकेत हो सकता है।", type: 'numeric', unit: 'kg' },
      { id: 'swelling', en: "Any swelling in your ankles, feet, or legs this week?", hi: "क्या इस हफ्ते आपके टखनों, पैरों या टाँगों में सूजन आई?", type: 'boolean' },
      { id: 'fatigue', en: "On a scale of 1 to 10, how much fatigue did you feel doing simple tasks like walking to another room?", hi: "1 से 10 पर, एक कमरे से दूसरे में जाने जैसे छोटे कामों में आपको कितनी थकान हुई?", type: 'scale', alert_above: 7 },
      { id: 'orthopnea', en: "Did you sleep with more pillows than usual, or did you wake up at night feeling breathless?", hi: "क्या आपने सामान्य से ज्यादा तकिए लगाकर सोए, या रात में सांस फूलकर जागे?", type: 'boolean' },
      { id: 'medication', en: "Did you take all your heart medications — including water pills — every day this week?", hi: "क्या आपने इस हफ्ते हर रोज अपनी सभी हृदय दवाइयाँ — पानी की गोलियाँ सहित — लीं?", type: 'boolean' },
    ],
  },
  general: {
    name_en: 'Weekly Health Check-in',
    name_hi: 'साप्ताहिक स्वास्थ्य जाँच',
    questions: [
      { id: 'overall', en: "On a scale of 1 to 10, how would you rate your overall health this week?", hi: "1 से 10 पर, इस हफ्ते आपका समग्र स्वास्थ्य कैसा रहा?", type: 'scale' },
      { id: 'symptoms', en: "Did you experience any new or worsening symptoms this week?", hi: "क्या इस हफ्ते कोई नया या बिगड़ता लक्षण हुआ?", type: 'boolean' },
      { id: 'medication', en: "Did you take all your medications as prescribed this week?", hi: "क्या आपने इस हफ्ते सभी दवाइयाँ निर्धारित तरीके से लीं?", type: 'boolean' },
      { id: 'sleep', en: "How would you rate your sleep quality this week on a scale of 1 to 10?", hi: "1 से 10 पर, इस हफ्ते आपकी नींद की गुणवत्ता कैसी थी?", type: 'scale' },
      { id: 'pain', en: "Any pain or discomfort this week? If yes, where and how severe on a scale of 1 to 10?", hi: "क्या इस हफ्ते कोई दर्द या तकलीफ हुई? अगर हाँ, तो कहाँ और 1 से 10 पर कितना?", type: 'text' },
    ],
  },
};

const DISEASE_OPTIONS: { key: string; label_en: string; label_hi: string }[] = [
  { key: 'general', label_en: 'General (no chronic condition)', label_hi: 'सामान्य' },
  { key: 'diabetes', label_en: 'Diabetes', label_hi: 'मधुमेह' },
  { key: 'hypertension', label_en: 'Hypertension / High BP', label_hi: 'उच्च रक्तचाप' },
  { key: 'copd', label_en: 'COPD / Breathing issues', label_hi: 'सांस की समस्या' },
  { key: 'heart_failure', label_en: 'Heart Failure', label_hi: 'हृदय रोग' },
];





const RISK_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  LOW:      { color: 'text-white',     bg: 'bg-[#1D9E75]', label: 'LOW RISK' },
  MODERATE: { color: 'text-slate-900', bg: 'bg-[#EF9F27]', label: 'MODERATE RISK' },
  HIGH:     { color: 'text-white',     bg: 'bg-[#D85A30]', label: 'HIGH RISK' },
  CRITICAL: { color: 'text-white',     bg: 'bg-[#E24B4A]', label: 'CRITICAL' },
};

// ─── Helper: speech synthesis ────────────────────────────────────────────────

// Keep global reference to prevent GC bug in Chrome/Edge
(window as any).ttsUtterances = (window as any).ttsUtterances || [];

function speakText(text: string, lang: Lang, onEnd?: () => void) {
  if (!('speechSynthesis' in window)) { onEnd?.(); return; }
  
  console.log('[TTS] Attempting to speak:', text.substring(0, 50));
  
  window.speechSynthesis.cancel();
  
  // A slight delay ensures cancel() completes before speaking new utterance, fixing dropped audio bugs in Chrome.
  setTimeout(() => {
    const utt = new SpeechSynthesisUtterance(text);
    (window as any).ttsUtterances.push(utt); // Prevent GC

    const targetLang = lang === 'hi' ? 'hi-IN' : 'en-US';
    utt.lang = targetLang;
    utt.rate = 1.0;
    utt.pitch = 1.0;
    utt.volume = 1.0;

    // Try to find a matching voice to ensure it plays correctly
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang === targetLang) || 
                  voices.find(v => v.lang.startsWith(targetLang.split('-')[0]));
    if (voice) {
      utt.voice = voice;
    }

    const cleanup = () => {
      const idx = (window as any).ttsUtterances.indexOf(utt);
      if (idx > -1) (window as any).ttsUtterances.splice(idx, 1);
      onEnd?.();
    };

    utt.onstart = () => console.log('[TTS] Speech started successfully.');
    utt.onend = cleanup;
    utt.onerror = (e) => {
      console.error('[TTS] Speech error event:', e);
      cleanup();
    };

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    
    window.speechSynthesis.speak(utt);
  }, 50);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TriagePage() {
  const patientId = useAuthStore((s) => s.patientId);
  const socket = useSocket();

  // ── Phase state ──
  const [phase, setPhase] = useState<'setup' | 'chat' | 'generating' | 'done'>('setup');
  const [disease, setDisease] = useState<string>('general');
  const [lang, setLang] = useState<Lang>('en');

  // ── Chat state ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentQIdx, setCurrentQIdx] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');

  // ── Refs to fix stale closures in STT/Timeouts ──
  const currentQIdxRef = useRef(currentQIdx);
  useEffect(() => { currentQIdxRef.current = currentQIdx; }, [currentQIdx]);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);

  // ── Voice state ──
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);

  // ── Summary state ──
  const [summary, setSummary] = useState<SoapSummary | null>(null);
  const [soapExpanded, setSoapExpanded] = useState(false);
  const [error, setError] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const hasSpeechSupport = !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );
  const hasTTSSupport = 'speechSynthesis' in window;
  const isChrome = /chrome/i.test(navigator.userAgent) && !/edge/i.test(navigator.userAgent);
  const isEdge = /edg/i.test(navigator.userAgent);

  const bank = QUESTION_BANKS[disease] || QUESTION_BANKS.general;
  const questions = bank.questions;

  // ── Auto-scroll ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Cleanup speechSynthesis on unmount ──
  useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  // ── Helper: add message ──
  function addMessage(role: 'ai' | 'patient', content: string) {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role, content, timestamp: new Date() },
    ]);
  }

  // ── Speak question with optional auto-listen ──
  function speak(text: string, thenListen = false, force = false) {
    if (!hasTTSSupport) {
      if (thenListen) startListening();
      return;
    }
    if (!ttsEnabled && !force) {
      if (thenListen) startListening();
      return;
    }
    setIsSpeaking(true);
    speakText(text, langRef.current, () => {
      setIsSpeaking(false);
      if (thenListen) startListening();
    });
  }

  // ── STT ──
  function startListening() {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = langRef.current === 'hi' ? 'hi-IN' : 'en-IN';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => setIsListening(true);
    rec.onresult = (e: any) => {
      const transcript: string = e.results[0]?.[0]?.transcript || '';
      setIsListening(false);
      if (transcript.trim()) handleSubmit(transcript.trim());
    };
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    rec.start();
    recognitionRef.current = rec;
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  // ── Start triage ──
  async function startTriage() {
    setError('');
    
    // User interaction "unlocks" speech synthesis for the rest of the session
    if ('speechSynthesis' in window) {
      const unlock = new SpeechSynthesisUtterance("");
      window.speechSynthesis.speak(unlock);
    }

    try {
      const res = await api.post<{ session_id: string, first_question: { id: string, en: string, hi: string } }>('/triage/start', {
        chief_complaint: `Weekly ${bank.name_en} check-in`,
        language: lang,
        condition_category: disease,
      });
      const sid = res.data.session_id;
      setSessionId(sid);
      setPhase('chat');

      const qText = lang === 'hi' ? res.data.first_question.hi : res.data.first_question.en;
      addMessage('ai', qText);
      speak(qText, true);

    } catch (err: any) {
      setError(err?.message || 'Failed to start triage');
    }
  }

  // ── Submit answer ──
  async function handleSubmit(answerText: string) {
    const sId = sessionIdRef.current;
    const currentLang = langRef.current;

    if (!sId || !answerText.trim()) return;

    const trimmed = answerText.trim();
    addMessage('patient', trimmed);
    setInput('');
    setPhase('generating'); // Use generating phase to show "Thinking..." spinner!

    try {
      const res = await api.post('/triage/answer', {
        session_id: sId,
        question_key: 'dynamic', // Not strictly used by backend anymore
        response_text: trimmed,
      });

      const { is_complete, next_question } = res.data as { is_complete: boolean; next_question: any };
      
      setPhase('chat');

      const qText = currentLang === 'hi' ? next_question.hi : next_question.en;
      addMessage('ai', qText);
      
      speak(qText, !is_complete);

      if (is_complete) {
        setTimeout(completeTriage, 1000);
      }

    } catch (err) {
      setPhase('chat');
      const errorMsg = currentLang === 'hi' 
        ? 'क्षमा करें, मुझे समझने में दिक्कत हुई। कृपया पुनः प्रयास करें।' 
        : 'Sorry, I am having trouble connecting. Could you please answer again?';
      addMessage('ai', errorMsg);
      speak(errorMsg, true);
    }
  }

  // ── Complete & generate Groq summary ──
  async function completeTriage() {
    const sId = sessionIdRef.current;
    const currentLang = langRef.current;

    if (!sId) return;

    setPhase('generating');

    try {
      const res = await api.post<SoapSummary>('/triage/generate-summary', {
        session_id: sId,
      });

      setSummary(res.data);
      setPhase('done');

      const risk = res.data.risk_level || 'MODERATE';
      const finalMsg = currentLang === 'hi'
        ? `आपकी रिपोर्ट आपके डॉक्टर को भेज दी गई है। जोखिम स्तर: ${risk}`
        : `Your report has been sent to your doctor. Risk level: ${risk}`;
      addMessage('ai', finalMsg);
      setTimeout(() => speak(finalMsg), 1500);

      socket?.emit('triage_complete_patient', {
        session_id: sId,
        patient_id: patientId,
        risk_level: risk,
      });

    } catch (err: any) {
      setError(err?.message || 'Summary generation failed');
      setPhase('chat');
    }
  }

  function resetTriage() {
    window.speechSynthesis?.cancel();
    if (sessionIdRef.current) {
      api.post(`/triage/abandon/${sessionIdRef.current}`).catch(() => {});
    }
    setPhase('setup');
    setMessages([]);
    setCurrentQIdx(0);
    setSessionId(null);
    setInput('');
    setSummary(null);
    setError('');
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const riskCfg = summary ? (RISK_CONFIG[summary.risk_level] || RISK_CONFIG.MODERATE) : null;

  return (
    <div className="flex flex-col gap-6">

      {/* Browser warning */}
      {!isChrome && !isEdge && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Voice features require Chrome or Edge.</strong> Other browsers don't support the Web Speech API used for TTS and STT.
        </div>
      )}

      {/* ── SETUP PHASE ── */}
      {phase === 'setup' && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900">AI Weekly Check-in</h2>
            <p className="mt-1 text-sm text-slate-500">Powered by Groq LLM · Voice + Text · Hindi / English</p>
          </div>

          {/* Language toggle */}
          <div className="mb-6 flex gap-2">
            <span className="self-center text-sm font-medium text-slate-600">Language:</span>
            {(['en', 'hi'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`rounded-xl px-4 py-1.5 text-sm font-bold transition ${
                  lang === l
                    ? 'bg-teal-700 text-white shadow'
                    : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {l === 'en' ? 'English' : 'हिन्दी'}
              </button>
            ))}
          </div>

          {/* Disease selector */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              {lang === 'hi' ? 'अपनी स्थिति चुनें:' : 'Select your condition:'}
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              {DISEASE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setDisease(opt.key)}
                  className={`rounded-2xl border p-3 text-left text-sm font-medium transition ${
                    disease === opt.key
                      ? 'border-teal-500 bg-teal-50 text-teal-900 shadow-sm'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {lang === 'hi' ? opt.label_hi : opt.label_en}
                </button>
              ))}
            </div>
          </div>

          {/* TTS toggle */}
          <div className="mb-6 flex items-center gap-3">
            <button
              onClick={() => setTtsEnabled((p) => !p)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
                ttsEnabled ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-600'
              }`}
            >
              {ttsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              {ttsEnabled ? (lang === 'hi' ? 'आवाज़ चालू' : 'Voice ON') : (lang === 'hi' ? 'आवाज़ बंद' : 'Voice OFF')}
            </button>
            <span className="text-xs text-slate-400">AI will speak each question aloud</span>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={15} /> {error}
            </div>
          )}

          <button
            onClick={startTriage}
            className="rounded-2xl bg-teal-700 px-8 py-3 font-bold text-white shadow-md transition hover:bg-teal-800 hover:shadow-lg active:scale-95"
          >
            {lang === 'hi' ? `${bank.name_hi} शुरू करें →` : `Start ${bank.name_en} →`}
          </button>

          <p className="mt-3 text-xs text-slate-400">
            {lang === 'hi' ? `${questions.length} सवाल · ~${Math.ceil(questions.length * 0.5)} मिनट` : `${questions.length} questions · ~${Math.ceil(questions.length * 0.5)} minutes`}
          </p>
        </div>
      )}

      {/* ── CHAT PHASE ── */}
      {(phase === 'chat' || phase === 'generating' || phase === 'done') && (
        <div className="flex flex-col rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden" style={{ height: 'calc(100vh - 180px)', minHeight: '500px' }}>

          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-teal-700 to-teal-800 px-5 py-3">
            <div>
              <p className="font-bold text-white">{lang === 'hi' ? bank.name_hi : bank.name_en}</p>
              <p className="text-xs text-teal-200">
                {phase === 'generating'
                  ? (lang === 'hi' ? 'विचार कर रहा है...' : 'Thinking...')
                  : phase === 'done'
                  ? (lang === 'hi' ? 'जाँच पूरी' : 'Check-in complete')
                  : (lang === 'hi' ? 'लाइव चैट चालू है' : 'Live Check-in Session')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Language toggle inline */}
              <button
                onClick={() => setLang((l) => l === 'en' ? 'hi' : 'en')}
                className="rounded-lg bg-teal-600 px-3 py-1 text-xs font-bold text-white hover:bg-teal-500"
              >
                {lang === 'en' ? 'हिं' : 'EN'}
              </button>
              {/* TTS toggle */}
              <button
                onClick={() => setTtsEnabled((p) => !p)}
                className="rounded-lg bg-teal-600 p-1.5 text-white hover:bg-teal-500"
                title={ttsEnabled ? 'Mute' : 'Unmute'}
              >
                {ttsEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </button>
              <button
                onClick={resetTriage}
                className="rounded-lg border border-teal-400 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-600"
              >
                {lang === 'hi' ? 'रीसेट' : 'Reset'}
              </button>
            </div>
          </div>

          {/* Chat thread */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#f0faf6]">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'patient' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'ai' && (
                  <div className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white shadow">
                    AI
                  </div>
                )}
                <div
                  className={`max-w-[75%] px-4 py-2.5 text-sm shadow-sm ${
                    msg.role === 'ai'
                      ? 'rounded-tl-none rounded-tr-2xl rounded-bl-2xl rounded-br-2xl bg-white text-slate-800 border border-slate-100'
                      : 'rounded-tl-2xl rounded-tr-none rounded-bl-2xl rounded-br-2xl bg-teal-700 text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{msg.content}</span>
                    {msg.role === 'ai' && (
                      <button 
                        onClick={() => speak(msg.content, false, true)}
                        className="ml-1 p-1 text-slate-300 hover:text-teal-600 transition-colors rounded-full hover:bg-slate-50"
                        title="Read aloud"
                      >
                        <Volume2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Speaking indicator */}
            {isSpeaking && (
              <div className="flex justify-start">
                <div className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white shadow">
                  AI
                </div>
                <div className="flex items-center gap-1 rounded-2xl bg-white border border-slate-100 px-4 py-3 shadow-sm">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="inline-block h-2 w-2 rounded-full bg-teal-600"
                      style={{ animation: `bounce 0.6s ${delay}ms infinite alternate` }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Listening indicator */}
            {isListening && (
              <div className="flex justify-end">
                <div className="flex items-center gap-2 rounded-2xl bg-teal-50 border border-teal-200 px-4 py-2.5 text-sm font-medium text-teal-800 shadow-sm animate-pulse">
                  <Mic size={14} />
                  {lang === 'hi' ? 'सुन रहा हूँ...' : 'Listening...'}
                </div>
              </div>
            )}

            {/* Generating indicator */}
            {phase === 'generating' && (
              <div className="flex justify-start">
                <div className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white shadow">AI</div>
                <div className="rounded-2xl bg-white border border-slate-100 px-4 py-3 text-sm text-slate-500 shadow-sm animate-pulse flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-teal-400 animate-bounce"></span>
                  {lang === 'hi' ? 'विचार कर रहा है...' : 'Analyzing your response...'}
                </div>
              </div>
            )}

            {/* Summary card */}
            {phase === 'done' && summary && riskCfg && (
              <div className="mx-auto mt-4 w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                {/* Risk header */}
                <div className={`flex items-center justify-between px-5 py-4 ${riskCfg.bg}`}>
                  <p className={`font-black text-lg tracking-wide ${riskCfg.color}`}>
                    Weekly Triage Summary
                  </p>
                  <span className={`rounded-xl border border-white/30 px-3 py-1 text-xs font-black ${riskCfg.color}`}>
                    {riskCfg.label}
                  </span>
                </div>

                <div className="p-5 space-y-4">
                  {/* Key concerns */}
                  {summary.key_concerns?.length > 0 && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Key Concerns</p>
                      <ul className="space-y-1.5">
                        {summary.key_concerns.map((c, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-400" />
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Doctor recommendation */}
                  {summary.doctor_recommendation && (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Doctor's Recommendation</p>
                      <p className="text-sm text-slate-700">{summary.doctor_recommendation}</p>
                    </div>
                  )}

                  {/* SOAP toggle */}
                  {summary.soap && (
                    <div>
                      <button
                        onClick={() => setSoapExpanded((p) => !p)}
                        className="text-xs font-semibold text-teal-700 hover:text-teal-900"
                      >
                        {soapExpanded ? '▲ Hide SOAP note' : '▼ View full SOAP note'}
                      </button>
                      {soapExpanded && (
                        <div className="mt-3 space-y-2 rounded-xl border border-slate-200 p-3 bg-slate-50 text-xs text-slate-700">
                          {(['subjective', 'objective', 'assessment', 'plan'] as const).map((key) => (
                            summary.soap![key] && (
                              <div key={key}>
                                <p className="font-bold uppercase text-slate-500">{key}</p>
                                <p>{summary.soap![key]}</p>
                              </div>
                            )
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sent to doctor */}
                  <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
                    <CheckCircle2 size={16} className="text-teal-600" />
                    {lang === 'hi' ? 'डॉक्टर के पास रिपोर्ट भेज दी गई है' : 'Report sent to your assigned doctor'}
                  </div>
                </div>

                <div className="border-t border-slate-100 px-5 py-3">
                  <button
                    onClick={resetTriage}
                    className="rounded-xl bg-teal-700 px-5 py-2 text-sm font-bold text-white hover:bg-teal-800 transition"
                  >
                    {lang === 'hi' ? 'नई जाँच शुरू करें' : 'Start new check-in'}
                  </button>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          {(phase === 'chat') && (
            <div className="border-t border-slate-100 bg-white px-4 py-3 flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(input); } }}
                placeholder={lang === 'hi' ? 'अपना जवाब यहाँ लिखें...' : 'Type your answer...'}
                className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-teal-400 focus:bg-white"
              />
              {hasSpeechSupport && (
                <button
                  onClick={isListening ? stopListening : startListening}
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition shadow ${
                    isListening
                      ? 'bg-red-500 text-white animate-pulse'
                      : 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                  }`}
                  title={isListening ? 'Stop listening' : 'Voice input'}
                >
                  {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              )}
              <button
                onClick={() => handleSubmit(input)}
                disabled={!input.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-700 text-white shadow transition hover:bg-teal-800 disabled:opacity-40"
              >
                <Send size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* CSS bounce keyframe injected inline */}
      <style>{`
        @keyframes bounce {
          from { transform: translateY(0); opacity: 0.6; }
          to   { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
