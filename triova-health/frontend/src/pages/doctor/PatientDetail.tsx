import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Download, FileUp, MessageSquareText } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ApiError, api } from '@/api/axios-instance';
import { SectionCard } from '@/components/ui/SectionCard';
import { StatCard } from '@/components/ui/StatCard';
import { UrgencyBadge } from '@/components/ui/UrgencyBadge';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Consultation, MedicalDocument } from '@/types/domain';

type Tab = 'overview' | 'vitals' | 'triage' | 'records' | 'consultations';

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'vitals', label: 'Vitals' },
  { key: 'triage', label: 'Triage' },
  { key: 'records', label: 'Records' },
  { key: 'consultations', label: 'Consultations' },
];

export default function PatientDetail() {
  const { patientId } = useParams();
  const [tab, setTab] = useState<Tab>('overview');
  const [metric, setMetric] = useState('heart_rate');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState('lab_report');
  const [message, setMessage] = useState('');

  const patientQuery = useQuery({
    queryKey: ['doctor-patient', patientId],
    enabled: !!patientId,
    queryFn: async () => (await api.get<{
      patient: { first_name: string; last_name: string; date_of_birth: string; gender: string; phone: string };
      allergies: Array<{ id: string; allergen: string; severity?: string }>;
      chronic_conditions: Array<{ id: string; condition_name: string }>;
      active_medications: Array<{ id: string; medication_name: string; dosage?: string; frequency?: string }>;
    }>(`/patients/${patientId}`)).data,
  });

  const analyticsQuery = useQuery({
    queryKey: ['doctor-patient-dashboard', patientId],
    enabled: !!patientId,
    queryFn: async () => (await api.get<{
      health_score: number;
      latest_vitals: { heart_rate?: number; spo2?: number; bp?: string; recorded_at?: string };
      active_alerts: Array<{ id: string; severity: string; alert_message: string; detected_at: string }>;
      last_7_days: Array<{ date: string; avg_heart_rate?: number }>;
    }>(`/analytics/patient/${patientId}/dashboard`)).data,
  });

  const trendsQuery = useQuery({
    queryKey: ['doctor-patient-trend', patientId, metric],
    enabled: !!patientId,
    queryFn: async () =>
      (await api.get<{ trend: string; trend_insight: string; data_points: Array<{ timestamp: string; value: number }> }>(
        `/analytics/patient/${patientId}/trends?metric=${metric}&days=14`
      )).data,
  });

  const triageQuery = useQuery({
    queryKey: ['doctor-patient-triage', patientId],
    enabled: !!patientId,
    queryFn: async () =>
      (await api.get<{ sessions: Array<{ id: string; created_at: string; chief_complaint?: string; urgency_level?: string; ai_summary?: string }> }>(
        `/triage/history/${patientId}?limit=10`
      )).data,
  });

  const docsQuery = useQuery({
    queryKey: ['doctor-patient-docs', patientId],
    enabled: !!patientId,
    queryFn: async () => (await api.get<{ documents: MedicalDocument[] }>(`/medical-records/patient/${patientId}`)).data,
  });

  const consultationsQuery = useQuery({
    queryKey: ['doctor-patient-consults', patientId],
    enabled: !!patientId,
    queryFn: async () => (await api.get<{ consultations: Consultation[] }>(`/consultations/patient/${patientId}`)).data,
  });

  async function askRecords(): Promise<void> {
    if (!patientId || !query.trim()) return;
    try {
      const res = await api.post<{ answer: string }>('/medical-records/chat', { patient_id: patientId, query });
      setAnswer(res.data.answer);
      setQuery('');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Failed to query records');
    }
  }

  async function uploadDocument(): Promise<void> {
    if (!patientId || !file) return;
    try {
      const form = new FormData();
      form.append('patient_id', patientId);
      form.append('document_type', documentType);
      form.append('file', file);
      await api.upload('/medical-records/upload', form);
      setFile(null);
      setMessage('Document uploaded and queued for processing.');
      await docsQuery.refetch();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Upload failed');
    }
  }

  async function exportPdf(): Promise<void> {
    if (!patientId) return;
    try {
      await api.download(`/medical-records/export/${patientId}`, `TRIOVA_${patientId}_history.pdf`);
      setMessage('Medical history exported.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Export failed');
    }
  }

  const patient = patientQuery.data?.patient;
  const vitals = analyticsQuery.data?.latest_vitals;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <SectionCard
          title={patient ? `${patient.first_name} ${patient.last_name}` : 'Patient detail'}
          subtitle={patient ? `${patient.gender} • ${formatDate(patient.date_of_birth)} • ${patient.phone}` : 'Loading patient profile'}
          right={
            <button type="button" onClick={exportPdf} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Download size={14} />
              Export PDF
            </button>
          }
        >
          <div className="flex flex-wrap gap-2">{tabs.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === item.key ? 'bg-triova-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{item.label}</button>)}</div>
        </SectionCard>
        <StatCard label="Health score" value={analyticsQuery.data?.health_score ?? '-'} hint="Live from analytics service" />
      </div>

      {message && <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{message}</div>}

      {tab === 'overview' && (
        <div className="grid gap-6 xl:grid-cols-3">
          <SectionCard title="Vitals snapshot" subtitle={formatDateTime(vitals?.recorded_at)}>
            <div className="space-y-2 text-sm text-slate-700">
              <p>Heart rate: <span className="font-semibold text-slate-900">{vitals?.heart_rate ?? '-'}</span></p>
              <p>SpO2: <span className="font-semibold text-slate-900">{vitals?.spo2 ?? '-'}</span></p>
              <p>Blood pressure: <span className="font-semibold text-slate-900">{vitals?.bp ?? '-'}</span></p>
            </div>
          </SectionCard>
          <SectionCard title="Conditions" subtitle="Chronic profile and allergy context">
            <div className="space-y-3 text-sm text-slate-700">
              <div>{(patientQuery.data?.chronic_conditions || []).map((item) => <p key={item.id} className="rounded-lg bg-slate-50 px-2 py-1">{item.condition_name}</p>)}</div>
              <div>{(patientQuery.data?.allergies || []).map((item) => <p key={item.id} className="rounded-lg bg-slate-50 px-2 py-1">{item.allergen} {item.severity ? `(${item.severity})` : ''}</p>)}</div>
            </div>
          </SectionCard>
          <SectionCard title="Active alerts" subtitle="Current risk signals">
            <div className="space-y-2">
              {(analyticsQuery.data?.active_alerts || []).map((alert) => <div key={alert.id} className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-semibold text-slate-500">{alert.severity}</p><p className="text-sm text-slate-800">{alert.alert_message}</p></div>)}
              {!analyticsQuery.data?.active_alerts.length && <p className="text-sm text-slate-500">No active alerts.</p>}
            </div>
          </SectionCard>
        </div>
      )}

      {tab === 'vitals' && (
        <SectionCard title="Vitals trends" subtitle={trendsQuery.data?.trend_insight || '14-day trend'}>
          <div className="mb-3 flex gap-2">{['heart_rate', 'spo2', 'steps', 'sleep_hours', 'stress_level'].map((item) => <button key={item} type="button" onClick={() => setMetric(item)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${metric === item ? 'bg-triova-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{item.replace('_', ' ')}</button>)}</div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendsQuery.data?.data_points || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="timestamp" tick={{ fill: '#475569', fontSize: 12 }} />
                <YAxis tick={{ fill: '#475569', fontSize: 12 }} />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="#0f766e" fill="#99f6e4" fillOpacity={0.35} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      )}

      {tab === 'triage' && (
        <SectionCard title="Triage history" subtitle="Recent AI pre-consultation reports">
          <div className="space-y-3">{(triageQuery.data?.sessions || []).map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between"><p className="text-xs text-slate-500">{formatDateTime(item.created_at)}</p><UrgencyBadge value={item.urgency_level || 'routine'} /></div><p className="mt-2 text-sm font-semibold text-slate-900">{item.chief_complaint || 'Triage session'}</p><p className="mt-1 text-sm text-slate-600">{item.ai_summary || 'Summary unavailable'}</p></div>)}</div>
        </SectionCard>
      )}

      {tab === 'records' && (
        <div className="grid gap-6 xl:grid-cols-3">
          <SectionCard title="Document upload" subtitle="Attach reports and scans">
            <div className="space-y-3">
              <select value={documentType} onChange={(event) => setDocumentType(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none">
                {['lab_report', 'prescription', 'imaging', 'discharge_summary', 'other'].map((type) => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}
              </select>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <FileUp size={14} />
                {file ? file.name : 'Choose file'}
                <input type="file" accept=".pdf,image/*" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              </label>
              <button type="button" onClick={uploadDocument} disabled={!file} className="rounded-xl bg-triova-700 px-4 py-2 text-sm font-semibold text-white hover:bg-triova-900 disabled:cursor-not-allowed disabled:opacity-60">Upload</button>
              <div className="space-y-2">{(docsQuery.data?.documents || []).map((doc) => <div key={doc.id} className="rounded-xl border border-slate-200 p-3"><p className="line-clamp-1 text-sm font-semibold text-slate-900">{doc.file_name}</p><p className="text-xs text-slate-500">{doc.document_type} • {doc.is_processed ? 'processed' : 'queued'}</p></div>)}</div>
            </div>
          </SectionCard>
          <SectionCard title="RAG chat" subtitle="Ask from uploaded records only" right={<MessageSquareText size={16} className="text-triova-700" />}>
            <div className="space-y-3">
              <textarea rows={4} value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none" placeholder="Ask a records question..." />
              <button type="button" onClick={askRecords} className="rounded-xl bg-triova-700 px-4 py-2 text-sm font-semibold text-white hover:bg-triova-900">Ask</button>
              {answer && <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{answer}</div>}
            </div>
          </SectionCard>
          <SectionCard title="Consultation context" subtitle="Recent consult notes snapshot">
            <div className="space-y-2">{(consultationsQuery.data?.consultations || []).slice(0, 6).map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">{formatDate(item.created_at)}</p><p className="text-sm font-semibold text-slate-900">{item.diagnosis || 'No diagnosis'}</p><p className="text-sm text-slate-600">{item.consultation_notes || item.prescription_text || 'No notes'}</p></div>)}</div>
          </SectionCard>
        </div>
      )}

      {tab === 'consultations' && (
        <SectionCard title="Consultation history" subtitle="All consultations for this patient">
          <div className="space-y-3">{(consultationsQuery.data?.consultations || []).map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">{formatDateTime(item.created_at)}</p><p className="text-sm font-semibold text-slate-900">{item.diagnosis || 'No diagnosis'}</p><p className="text-sm text-slate-700">{item.consultation_notes || item.prescription_text || 'No notes recorded.'}</p></div>)}</div>
        </SectionCard>
      )}

      {patientQuery.isError && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={15} />Unable to load patient details.</div>}
    </div>
  );
}
