import { ChangeEvent, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ImagePlus, Mic, Square } from 'lucide-react';
import { ApiError, api } from '@/api/axios-instance';
import { SectionCard } from '@/components/ui/SectionCard';
import { UrgencyBadge } from '@/components/ui/UrgencyBadge';
import { formatDateTime } from '@/lib/format';

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
type WindowWithSpeech = Window & {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

interface TriageQuestion {
  key: string;
  text_en: string;
  type: string;
}

interface TriageSummary {
  id: string;
  urgency_level: string;
  ai_summary?: string;
  key_symptoms?: string[];
  recommended_actions?: string[];
  completed_at?: string;
}

export default function TriagePage() {
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [question, setQuestion] = useState<TriageQuestion | null>(null);
  const [questionIndex, setQuestionIndex] = useState(1);
  const [answer, setAnswer] = useState('');
  const [summary, setSummary] = useState<TriageSummary | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [lastImageResult, setLastImageResult] = useState('');
  const speechWindow = window as WindowWithSpeech;

  const hasSpeechSupport = useMemo(
    () => !!(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition),
    []
  );

  async function startTriage(): Promise<void> {
    if (!chiefComplaint.trim()) {
      setError('Please add your chief complaint first.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      const res = await api.post<{ session_id: string; first_question: TriageQuestion }>(
        '/triage/start',
        { chief_complaint: chiefComplaint, language: 'en' }
      );
      setSessionId(res.data.session_id);
      setQuestion(res.data.first_question);
      setQuestionIndex(1);
      setSummary(null);
      setAnswer('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start triage');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitAnswer(): Promise<void> {
    if (!sessionId || !question) return;
    if (!answer.trim()) {
      setError('Please enter an answer before continuing.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      const res = await api.post<{
        is_complete: boolean;
        is_emergency?: boolean;
        next_question?: TriageQuestion;
        summary?: TriageSummary;
      }>('/triage/answer', {
        session_id: sessionId,
        question_key: question.key,
        response_text: answer,
      });

      setAnswer('');
      if (res.data.is_complete && res.data.summary) {
        setSummary(res.data.summary);
        setQuestion(null);
        return;
      }
      if (res.data.next_question) {
        setQuestion(res.data.next_question);
        setQuestionIndex((prev) => prev + 1);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit answer');
    } finally {
      setIsSubmitting(false);
    }
  }

  function startSpeechToText(): void {
    const ctor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!ctor) return;
    const recognition = new ctor();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      const transcript = event.results[0]?.[0]?.transcript || '';
      setAnswer((prev) => `${prev} ${transcript}`.trim());
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
    setIsListening(true);
  }

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file || !sessionId) return;
    const form = new FormData();
    form.append('session_id', sessionId);
    form.append('image', file);
    try {
      const res = await api.upload<{ ai_analysis?: string }>('/triage/upload-image', form);
      setLastImageResult(res.data.ai_analysis || 'Image submitted successfully.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Image upload failed');
    } finally {
      event.target.value = '';
    }
  }

  function resetSession(): void {
    setSessionId(null);
    setQuestion(null);
    setQuestionIndex(1);
    setAnswer('');
    setSummary(null);
    setLastImageResult('');
    setError('');
  }

  return (
    <div className="space-y-6">
      <SectionCard title="AI triage assistant" subtitle="One-question-at-a-time guided pre-consultation flow">
        {!sessionId && (
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Chief complaint</span>
              <textarea
                rows={4}
                value={chiefComplaint}
                onChange={(event) => setChiefComplaint(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-triova-500"
                placeholder="Describe your symptoms and concerns..."
              />
            </label>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={startTriage}
              className="rounded-xl bg-triova-700 px-4 py-2 text-sm font-semibold text-white hover:bg-triova-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Starting...' : 'Start triage'}
            </button>
          </div>
        )}

        {!!sessionId && !summary && question && (
          <div className="space-y-4">
            <div className="rounded-xl border border-triova-200 bg-triova-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-triova-700">Question {questionIndex}</p>
              <p className="mt-1 text-base font-medium text-slate-900">{question.text_en}</p>
            </div>
            <textarea
              rows={4}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-triova-500"
              placeholder="Type your response"
            />
            <div className="flex flex-wrap items-center gap-2">
              {hasSpeechSupport && (
                <button
                  type="button"
                  onClick={startSpeechToText}
                  disabled={isListening}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isListening ? <Square size={14} /> : <Mic size={14} />}
                  {isListening ? 'Listening...' : 'Voice input'}
                </button>
              )}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <ImagePlus size={14} />
                Upload image
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={submitAnswer}
                className="rounded-xl bg-triova-700 px-4 py-2 text-sm font-semibold text-white hover:bg-triova-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Submitting...' : 'Next question'}
              </button>
              <button
                type="button"
                onClick={resetSession}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Restart
              </button>
            </div>
            {lastImageResult && (
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Image analysis</p>
                <p>{lastImageResult}</p>
              </div>
            )}
          </div>
        )}

        {summary && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="text-emerald-700" size={18} />
                <p className="font-semibold text-emerald-900">Triage completed</p>
              </div>
              <UrgencyBadge value={summary.urgency_level} />
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">AI Summary</p>
              <p className="mt-1 text-sm text-slate-700">{summary.ai_summary || 'No summary generated.'}</p>
              {!!summary.key_symptoms?.length && (
                <>
                  <p className="mt-3 text-sm font-semibold text-slate-900">Key symptoms</p>
                  <ul className="mt-1 list-inside list-disc text-sm text-slate-700">
                    {summary.key_symptoms.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              {!!summary.recommended_actions?.length && (
                <>
                  <p className="mt-3 text-sm font-semibold text-slate-900">Recommended actions</p>
                  <ul className="mt-1 list-inside list-disc text-sm text-slate-700">
                    {summary.recommended_actions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              {summary.completed_at && (
                <p className="mt-3 text-xs text-slate-500">Completed at {formatDateTime(summary.completed_at)}</p>
              )}
            </div>
            <button
              type="button"
              onClick={resetSession}
              className="rounded-xl bg-triova-700 px-4 py-2 text-sm font-semibold text-white hover:bg-triova-900"
            >
              Start new triage
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
