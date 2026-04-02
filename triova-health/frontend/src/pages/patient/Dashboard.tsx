import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Bell, CalendarClock, ClipboardList, HeartPulse, Pill } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/api/axios-instance';
import { useAuthStore } from '@/store/auth.store';
import { SectionCard } from '@/components/ui/SectionCard';
import { StatCard } from '@/components/ui/StatCard';
import { UrgencyBadge } from '@/components/ui/UrgencyBadge';
import { formatDate, formatDateTime, formatTime } from '@/lib/format';
import type { Appointment, NotificationItem } from '@/types/domain';

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

export default function PatientDashboard() {
  const patientId = useAuthStore((s) => s.patientId);
  const userId = useAuthStore((s) => s.userId);

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
      const res = await api.get<{ reminders: Array<{ id: string; medication: string; time: string; is_active: boolean }> }>(
        `/notifications/reminders/${patientId}`
      );
      return res.data;
    },
  });

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

  const dash = dashboardQuery.data;
  const vitals = dash?.latest_vitals || {};
  const upcoming = appointmentsQuery.data?.upcoming || [];
  const reminders = remindersQuery.data?.reminders || [];
  const triageSessions = triageHistoryQuery.data?.sessions || [];
  const notifications = notificationsQuery.data?.notifications || [];
  const trendSeries = dash?.last_7_days || [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Health score"
          value={dash?.health_score ?? '-'}
          icon={<HeartPulse size={18} />}
          hint={dash ? 'Based on active alerts and trend stability' : 'Loading latest analytics'}
        />
        <StatCard
          label="Heart rate"
          value={vitals.heart_rate ? `${vitals.heart_rate} bpm` : '-'}
          icon={<Activity size={18} />}
          hint={`SpO2 ${vitals.spo2 ?? '-'}%`}
        />
        <StatCard
          label="Blood pressure"
          value={vitals.bp || '-'}
          icon={<ClipboardList size={18} />}
          hint={`Stress ${vitals.stress ?? '-'} / 100`}
        />
        <StatCard
          label="Next appointment"
          value={upcoming[0] ? `${formatDate(upcoming[0].appointment_date)} ${formatTime(upcoming[0].appointment_time)}` : 'None'}
          icon={<CalendarClock size={18} />}
          hint={upcoming[0]?.doctor_first_name ? `Dr. ${upcoming[0].doctor_first_name} ${upcoming[0].doctor_last_name || ''}` : 'Book your next checkup'}
        />
      </div>

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

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard
            title="7-day vitals trend"
            subtitle={vitals.recorded_at ? `Latest reading: ${formatDateTime(vitals.recorded_at)}` : 'Track your recent baseline'}
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendSeries}>
                  <defs>
                    <linearGradient id="hrFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0d9488" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#475569', fontSize: 12 }} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="avg_heart_rate"
                    stroke="#0f766e"
                    strokeWidth={2}
                    fill="url(#hrFill)"
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

          <SectionCard title="Recent triage sessions" subtitle="Latest urgency and summary">
            <div className="space-y-3">
              {triageSessions.map((session) => (
                <div key={session.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-500">{formatDateTime(session.created_at)}</p>
                    <UrgencyBadge value={session.urgency_level} />
                  </div>
                  <p className="text-sm font-medium text-slate-900">{session.chief_complaint || 'Triage session'}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{session.ai_summary || 'Summary pending'}</p>
                </div>
              ))}
              {!triageSessions.length && <p className="text-sm text-slate-500">No triage sessions yet.</p>}
            </div>
          </SectionCard>

          <SectionCard
            title="Recent notifications"
            subtitle="Alerts, reminders, and updates"
            right={
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                <Bell size={12} />
                {notificationsQuery.data?.unread_count || 0}
              </span>
            }
          >
            <div className="space-y-2">
              {notifications.map((note) => (
                <div key={note.id} className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-sm font-medium text-slate-900">{note.title}</p>
                  <p className="text-xs text-slate-600">{note.message}</p>
                </div>
              ))}
              {!notifications.length && <p className="text-sm text-slate-500">No notifications yet.</p>}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
