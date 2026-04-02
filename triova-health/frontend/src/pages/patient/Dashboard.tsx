import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Bell, CalendarClock, ClipboardList, HeartPulse, Pill, X } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/api/axios-instance';
import { useAuthStore } from '@/store/auth.store';
import { SectionCard } from '@/components/ui/SectionCard';
import { StatCard } from '@/components/ui/StatCard';
import { UrgencyBadge } from '@/components/ui/UrgencyBadge';
import { formatDate, formatTime } from '@/lib/format';
import type { Appointment, NotificationItem } from '@/types/domain';

// ─── Live vitals simulation ────────────────────────────────────────────────

interface Vitals {
  hr: number;
  spo2: number;
  systolic: number;
  diastolic: number;
  stress: number;
  score: number;
  inCrisis: boolean;
}

function generateVitals(t: number): Vitals {
  const inCrisis = t >= 60 && t <= 85;

  const hr = inCrisis
    ? Math.round(135 + Math.random() * 10)
    : Math.round(72 + 6 * Math.sin(t / 12) + (Math.random() - 0.5) * 4);

  const spo2 = inCrisis
    ? parseFloat((89 + Math.random() * 1.5).toFixed(1))
    : parseFloat((97.5 + 0.8 * Math.sin(t / 20) + (Math.random() - 0.5) * 0.4).toFixed(1));

  const systolic = inCrisis
    ? Math.round(158 + Math.random() * 8)
    : Math.round(118 + 5 * Math.sin(t / 18) + (Math.random() - 0.5) * 3);

  const diastolic = Math.round(76 + 3 * Math.sin(t / 22) + (Math.random() - 0.5) * 2);

  const stress = inCrisis
    ? Math.round(82 + Math.random() * 8)
    : Math.round(30 + 12 * Math.sin(t / 35) + (Math.random() - 0.5) * 5);

  let score = 100;
  if (hr > 110 || hr < 55) score -= 15;
  else if (hr > 95 || hr < 62) score -= 5;
  if (spo2 < 90) score -= 20;
  else if (spo2 < 94) score -= 10;
  else if (spo2 < 96) score -= 4;
  if (systolic > 145) score -= 10;
  else if (systolic > 130) score -= 4;
  if (stress > 75) score -= 10;
  else if (stress > 60) score -= 4;
  score = Math.max(0, Math.min(100, score));

  return { hr, spo2, systolic, diastolic, stress, score, inCrisis };
}

// ─── Colour helpers ────────────────────────────────────────────────────────

const TEAL  = '#0F6E56';
const AMBER = '#854F0B';
const RED   = '#A32D2D';

function scoreColor(s: number)    { return s >= 80 ? TEAL : s >= 60 ? AMBER : RED; }
function hrColor(hr: number)      { return hr >= 60 && hr <= 100 ? TEAL : RED; }
function bpColor(sys: number)     { return sys < 130 ? TEAL : sys < 145 ? AMBER : RED; }
function spo2Color(s: number)     { return s >= 95 ? '#64748b' : RED; }
function stressColor(s: number)   { return s <= 60 ? '#64748b' : s <= 75 ? AMBER : RED; }

// ─── Backend data types ────────────────────────────────────────────────────

interface PatientDashboardData {
  health_score: number;
  latest_vitals: {
    heart_rate?: number;
    spo2?: number;
    bp?: string;
    temperature?: number;
    steps?: number;
    sleep?: number;
    stress?: number;
    recorded_at?: string;
  };
  active_alerts: Array<{ id: string; alert_message: string; severity: string; detected_at: string }>;
  trend_summaries: Array<{ metric: string; trend: string; change_percent: number }>;
  last_7_days: Array<{
    date: string;
    avg_heart_rate?: number;
    avg_spo2?: number;
    avg_steps?: number;
    avg_stress_level?: number;
    avg_sleep_hours?: number;
  }>;
}

import { useSocket } from '@/hooks/useSocket'; // <-- NEW IMPORT

// ─── Component ─────────────────────────────────────────────────────────────

export default function PatientDashboard() {
  const patientId = useAuthStore((s) => s.patientId);
  const userId    = useAuthStore((s) => s.userId);
  const socket    = useSocket(); // <-- GET SOCKET

  // ── Live vitals state ──
  const [vitals, setVitals]               = useState<Vitals>(generateVitals(0));
  const [showAlert, setShowAlert]         = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [liveData, setLiveData]           = useState<{ time: string; hr: number }[]>([]);

  useEffect(() => {
    let t = 0;
    let wasInCrisis = false;
    
    // Clear any leftover state on mount (Optional, but safe to keep for local UI)
    localStorage.removeItem('triova_patient_crisis');
    
    const interval = setInterval(() => {
      t += 2;
      const next = generateVitals(t);
      setVitals(next);

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setLiveData(prev => {
        const updated = [...prev, { time: timeStr, hr: next.hr }];
        if (updated.length > 30) return updated.slice(updated.length - 30);
        return updated;
      });

      if (next.inCrisis) {
        setShowAlert((prev) => {
          if (!wasInCrisis && !prev) return true;
          return prev;
        });
        
        // STREAM VITALS TO BACKEND SOCKET
        socket?.emit('patient_crisis', {
          active: true,
          timestamp: Date.now(),
          vitals: next,
          patientName: 'Raj Kumar',
          patientId: patientId
        });
        
        wasInCrisis = true;
      } 
      else if (!next.inCrisis && wasInCrisis) {
        setShowAlert(false);
        setAlertDismissed(false);
        
        // Notify backend crisis ended
        socket?.emit('patient_crisis', {
          active: false,
          timestamp: Date.now(),
          patientId: patientId
        });
        
        wasInCrisis = false;
      }
    }, 2000);
    
    return () => {
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, patientId]); // <-- ADDED DEPS

  // ── Backend queries ──
  const dashboardQuery = useQuery({
    queryKey: ['patient-dashboard', patientId],
    enabled: !!patientId,
    queryFn: async () => {
      const res = await api.get<PatientDashboardData>(`/analytics/patient/${patientId}/dashboard`);
      return res.data;
    },
  });

  const appointmentsQuery = useQuery({
    queryKey: ['patient-appointments', patientId],
    enabled: !!patientId,
    queryFn: async () => {
      const res = await api.get<{ upcoming: Appointment[]; past: Appointment[] }>(`/appointments/patient/${patientId}`);
      return res.data;
    },
  });

  const remindersQuery = useQuery({
    queryKey: ['patient-reminders', patientId],
    enabled: !!patientId,
    queryFn: async () => {
      const res = await api.get<{ medications: Array<{ id: string; medication_name: string; dosage: string; frequency: string; timing_instructions: string; start_date: string; end_date: string; is_active: boolean }>; reminders: Array<{ id: string; medication_id: string; reminder_time: string; is_active: boolean; medication_name: string }> }>(
        `/medications/patient/${patientId}`
      );
      return res.data;
    },
  });

  const dash          = dashboardQuery.data;
  const upcoming      = appointmentsQuery.data?.upcoming || [];
  const reminders     = (remindersQuery.data?.reminders || []).map((r) => ({
    id: r.id,
    medication: r.medication_name,
    time: r.reminder_time,
    is_active: r.is_active,
  }));
  
  // Triage history and notifications were missing in Anshul's branch, restoring them
  const triageHistoryQuery = useQuery({
    queryKey: ['patient-triage-history', patientId],
    enabled: !!patientId,
    queryFn: async () => {
      const res = await api.get<{ sessions: Array<{ id: string; created_at: string; urgency_level: string; ai_summary?: string; chief_complaint?: string }> }>(
        `/triage/history/${patientId}?limit=5`
      );
      return res.data;
    },
  });

  const notificationsQuery = useQuery({
    queryKey: ['patient-notifications', userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await api.get<{ notifications: NotificationItem[]; unread_count: number }>(
        `/notifications/user/${userId}?limit=8`
      );
      return res.data;
    },
  });

  const triageSessions = triageHistoryQuery.data?.sessions || [];
  const notifications = notificationsQuery.data?.notifications || [];
  const trendSeries   = dash?.last_7_days || [];
  const latestVitals  = dash?.latest_vitals || {};

  return (
    <div className="space-y-6">

      {/* ── Emergency alert banner ── */}
      {showAlert && (
        <div
          style={{
            background: '#FCEBEB',
            border: '1px solid #F09595',
            borderRadius: 12,
            padding: '12px 16px',
            color: RED,
            fontSize: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>
            ⚠️ <strong>Critical vitals detected</strong> — Heart rate{' '}
            <strong>{vitals.hr} bpm</strong>, SpO2{' '}
            <strong>{vitals.spo2}%</strong>. Your assigned doctor has been notified.
          </span>
          <button
            onClick={() => { setShowAlert(false); setAlertDismissed(true); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, marginLeft: 16, padding: 4, display: 'flex', alignItems: 'center' }}
            aria-label="Dismiss alert"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Section heading with LIVE indicator ── */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Real-time vitals</p>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: TEAL, fontWeight: 500 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#1D9E75',
              animation: 'pulse 1.5s ease-in-out infinite',
              display: 'inline-block',
            }}
          />
          Live · Noise ColorFit Pro 4
        </span>
      </div>

      {/* ── 4 vital stat cards ── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">

        {/* Card 1 — Health score */}
        <StatCard
          label="Health score"
          icon={<HeartPulse size={18} />}
          value={
            <span style={{ color: scoreColor(vitals.score) }}>
              {vitals.score}
            </span>
          }
          hint="Based on active alerts and trend stability"
        />

        {/* Card 2 — Heart rate */}
        <StatCard
          label="Heart rate"
          icon={<Activity size={18} />}
          value={
            <span style={{ color: hrColor(vitals.hr) }}>
              {vitals.hr} bpm
            </span>
          }
          hintNode={
            <span style={{ color: spo2Color(vitals.spo2) }}>
              SpO2 {vitals.spo2}%
            </span>
          }
        />

        {/* Card 3 — Blood pressure */}
        <StatCard
          label="Blood pressure"
          icon={<ClipboardList size={18} />}
          value={
            <span style={{ color: bpColor(vitals.systolic) }}>
              {vitals.systolic}/{vitals.diastolic}
            </span>
          }
          hintNode={
            <span style={{ color: stressColor(vitals.stress) }}>
              Stress {vitals.stress} / 100
            </span>
          }
        />

        {/* Card 4 — Next appointment (unchanged) */}
        <StatCard
          label="Next appointment"
          value={upcoming[0]
            ? `${formatDate(upcoming[0].appointment_date)} ${formatTime(upcoming[0].appointment_time)}`
            : 'None'}
          icon={<CalendarClock size={18} />}
          hint={
            upcoming[0]?.doctor_first_name
              ? `Dr. ${upcoming[0].doctor_first_name} ${upcoming[0].doctor_last_name || ''}`
              : 'Book your next checkup'
          }
        />
      </div>

      {/* ── Quick-action links ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Link
          to="/patient/book"
          className="rounded-2xl border border-triova-200 bg-gradient-to-br from-triova-50 to-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <p className="text-lg font-semibold text-triova-900">Book appointment</p>
          <p className="mt-1 text-sm text-slate-600">Voice + manual booking with next-slot suggestions.</p>
        </Link>
        <Link
          to="/patient/triage"
          className="rounded-2xl border border-triova-200 bg-gradient-to-br from-triova-50 to-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <p className="text-lg font-semibold text-triova-900">Start triage</p>
          <p className="mt-1 text-sm text-slate-600">Dynamic AI question flow with urgency classification.</p>
        </Link>
        <Link
          to="/patient/records"
          className="rounded-2xl border border-triova-200 bg-gradient-to-br from-triova-50 to-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <p className="text-lg font-semibold text-triova-900">Medical records</p>
          <p className="mt-1 text-sm text-slate-600">Upload docs, chat with records, and export PDF history.</p>
        </Link>
      </div>

      {/* ── Charts + sidebar ── */}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard
            title="Live Heart Rate Monitor"
            subtitle="Real-time wearable telemetry"
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={liveData}>
                  <defs>
                    <linearGradient id="hrFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#0d9488" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 12 }} />
                  <YAxis domain={['auto', 'auto']} tick={{ fill: '#475569', fontSize: 12 }} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="hr"
                    stroke="#0f766e"
                    strokeWidth={2}
                    fill="url(#hrFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard
            title="Upcoming appointments"
            subtitle="Queue and schedule overview"
            right={<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{upcoming.length}</span>}
          >
            <div className="space-y-3">
              {upcoming.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {formatDate(item.appointment_date)} at {formatTime(item.appointment_time)}
                    </p>
                    <p className="text-sm text-slate-600">
                      Dr. {item.doctor_first_name} {item.doctor_last_name} · {item.specialization || 'General'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <UrgencyBadge value={item.urgency} />
                    {item.queue_position != null && (
                      <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        Queue #{item.queue_position}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {!upcoming.length && <p className="text-sm text-slate-500">No upcoming appointments.</p>}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Medication reminders" subtitle="Today and active schedule">
            <div className="space-y-2">
              {reminders.slice(0, 6).map((reminder) => (
                <div key={reminder.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Pill size={15} className="text-triova-700" />
                    <p className="text-sm font-medium text-slate-800">{reminder.medication}</p>
                  </div>
                  <p className="text-xs text-slate-600">{formatTime(reminder.time)}</p>
                </div>
              ))}
              {!reminders.length && <p className="text-sm text-slate-500">No active reminders.</p>}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

