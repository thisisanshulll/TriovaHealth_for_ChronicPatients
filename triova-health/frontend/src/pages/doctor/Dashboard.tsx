import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Clock3, RefreshCw, Stethoscope, ExternalLink } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ApiError, api } from '@/api/axios-instance';
import { SectionCard } from '@/components/ui/SectionCard';
import { StatCard } from '@/components/ui/StatCard';
import { UrgencyBadge } from '@/components/ui/UrgencyBadge';
import { formatDate, formatTime } from '@/lib/format';
import { useAuthStore } from '@/store/auth.store';

interface QueuePatient {
  id: string;
  first_name: string;
  last_name: string;
  chief_complaint?: string;
  ai_summary?: string;
  urgency_level?: string;
}

interface DoctorAlert {
  id: string;
  patient_id: string;
  metric_name: string;
  alert_message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'acknowledged' | 'resolved';
  detected_at: string;
  first_name: string;
  last_name: string;
}

interface DoctorAppointment {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  appointment_date: string;
  appointment_time: string;
  urgency: string;
  status: string;
  chief_complaint?: string;
}

interface DoctorDashboardData {
  patients_by_urgency: {
    emergency: QueuePatient[];
    urgent: QueuePatient[];
    routine: QueuePatient[];
  };
  todays_appointments: DoctorAppointment[];
  recent_alerts: DoctorAlert[];
  stats: {
    total_patients: number;
    appointments_today: number;
    active_alerts: number;
  };
}

interface DoctorScheduleData {
  appointments: DoctorAppointment[];
  counts: {
    emergency: number;
    urgent: number;
    routine: number;
    total: number;
  };
}

const statusOptions = ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled'] as const;

export default function DoctorDashboard() {
  const doctorId = useAuthStore((s) => s.doctorId);
  const [searchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState('');
  const [busyKey, setBusyKey] = useState('');

  if (!doctorId) {
    return (
      <div className="p-6">
        <p className="text-red-500">Doctor ID not found (got: {doctorId}). Please login again.</p>
      </div>
    );
  }

  const view = searchParams.get('view') === 'patients' ? 'patients' : searchParams.get('view') === 'schedule' ? 'schedule' : 'overview';

  const dashboardQuery = useQuery({
    queryKey: ['doctor-dashboard', doctorId],
    enabled: !!doctorId,
    refetchInterval: 15000,
    staleTime: 0,
    queryFn: async () => {
      console.log('Fetching dashboard for doctor:', doctorId);
      const res = await api.get<DoctorDashboardData>(`/analytics/doctor/${doctorId}/dashboard`);
      console.log('Dashboard response:', res.data);
      return res.data;
    },
  });

  const scheduleQuery = useQuery({
    queryKey: ['doctor-schedule', doctorId, selectedDate],
    enabled: !!doctorId && !!selectedDate,
    refetchInterval: 5000,
    staleTime: 0,
    queryFn: async () => {
      console.log('Fetching schedule for doctor:', doctorId, 'date:', selectedDate);
      const res = await api.get<DoctorScheduleData>(`/appointments/doctor/${doctorId}?date=${selectedDate}`);
      console.log('Schedule response:', res.data);
      return res.data;
    },
  });

  const countsChart = useMemo(
    () => [
      { name: 'Emergency', value: scheduleQuery.data?.counts.emergency || 0 },
      { name: 'Urgent', value: scheduleQuery.data?.counts.urgent || 0 },
      { name: 'Routine', value: scheduleQuery.data?.counts.routine || 0 },
    ],
    [scheduleQuery.data]
  );

  const criticalAlerts = (dashboardQuery.data?.recent_alerts || []).filter((alert) => alert.severity === 'critical');

  const [googleCalConnected, setGoogleCalConnected] = useState(false);

  const googleStatusQuery = useQuery({
    queryKey: ['google-calendar-status'],
    queryFn: async () => {
      const res = await api.get<{ connected: boolean }>('/auth/google/status');
      return res.data.connected;
    },
  });

  useMemo(() => {
    if (googleStatusQuery.data !== undefined) {
      setGoogleCalConnected(googleStatusQuery.data);
    }
  }, [googleStatusQuery.data]);

  async function connectGoogleCalendar() {
    try {
      const res = await api.get<{ url: string; state: string }>('/auth/google');
      window.location.href = res.data.url;
    } catch (error) {
      console.error('Failed to get Google auth URL:', error);
    }
  }

  const queueColumns = [
    { key: 'emergency', label: 'Emergency', tone: 'border-red-200 bg-red-50' },
    { key: 'urgent', label: 'Urgent', tone: 'border-amber-200 bg-amber-50' },
    { key: 'routine', label: 'Routine', tone: 'border-emerald-200 bg-emerald-50' },
  ] as const;

  async function refreshAll(): Promise<void> {
    await Promise.all([dashboardQuery.refetch(), scheduleQuery.refetch()]);
  }

  async function patchAppointmentStatus(id: string, status: (typeof statusOptions)[number]): Promise<void> {
    try {
      setBusyKey(`appt-${id}`);
      await api.patch(`/appointments/${id}/status`, { status });
      setMessage(`Appointment status updated to ${status.replace('_', ' ')}.`);
      await refreshAll();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Failed to update appointment status');
    } finally {
      setBusyKey('');
    }
  }

  async function patchAlertStatus(alertId: string, action: 'acknowledge' | 'resolve'): Promise<void> {
    try {
      setBusyKey(`alert-${alertId}-${action}`);
      await api.patch(`/analytics/alerts/${alertId}/${action}`);
      setMessage(action === 'resolve' ? 'Alert resolved.' : 'Alert acknowledged.');
      await refreshAll();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Failed to update alert');
    } finally {
      setBusyKey('');
    }
  }

  const allQueue =
    (dashboardQuery.data?.patients_by_urgency.emergency || []).length +
    (dashboardQuery.data?.patients_by_urgency.urgent || []).length +
    (dashboardQuery.data?.patients_by_urgency.routine || []).length;

  return (
    <div className="space-y-6">
      {criticalAlerts.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-900">
            <AlertTriangle size={16} />
            Critical alerts require immediate review ({criticalAlerts.length})
          </p>
          <div className="mt-2 space-y-2">
            {criticalAlerts.slice(0, 3).map((alert) => (
              <p key={alert.id} className="text-sm text-red-800">
                {alert.first_name} {alert.last_name}: {alert.alert_message}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Assigned patients"
          value={dashboardQuery.data?.stats.total_patients ?? '-'}
          icon={<Stethoscope size={18} />}
          hint="Active doctor-patient assignments"
        />
        <StatCard
          label="Queue size"
          value={allQueue || '-'}
          icon={<Clock3 size={18} />}
          hint="Emergency, urgent, routine combined"
        />
        <StatCard
          label="Appointments today"
          value={dashboardQuery.data?.stats.appointments_today ?? '-'}
          icon={<CalendarDays size={18} />}
          hint={formatDate(selectedDate)}
        />
        <StatCard
          label="Active alerts"
          value={dashboardQuery.data?.stats.active_alerts ?? '-'}
          icon={<AlertTriangle size={18} />}
          hint="Across all assigned patients"
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold text-slate-500">Google Calendar</p>
          <p className="mt-1 text-sm text-slate-700">{googleCalConnected ? 'Connected' : 'Not connected'}</p>
          {!googleCalConnected && (
            <button
              type="button"
              onClick={connectGoogleCalendar}
              className="mt-2 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <ExternalLink size={12} />
              Connect
            </button>
          )}
        </div>
      </div>

      {message && <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{message}</div>}

      {(view === 'overview' || view === 'patients') && (
        <SectionCard title="Priority patient queue" subtitle="Emergency patients stay on top">
          <div className="grid gap-4 xl:grid-cols-3">
            {queueColumns.map((column) => {
              const list = dashboardQuery.data?.patients_by_urgency[column.key] || [];
              return (
                <div key={column.key} className={`rounded-xl border p-3 ${column.tone}`}>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="font-semibold text-slate-900">{column.label}</p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {list.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {list.map((patient) => (
                      <Link
                        key={patient.id}
                        to={`/doctor/patients/${patient.id}`}
                        className="block rounded-xl border border-white/60 bg-white p-3 shadow-sm transition hover:shadow"
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-slate-900">
                            {patient.first_name} {patient.last_name}
                          </p>
                          <UrgencyBadge value={patient.urgency_level || column.key} />
                        </div>
                        <p className="mt-1 text-xs font-medium text-slate-700">
                          {patient.chief_complaint || 'No complaint captured'}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                          {patient.ai_summary || 'Triage summary pending.'}
                        </p>
                      </Link>
                    ))}
                    {!list.length && <p className="text-sm text-slate-500">No patients in this queue.</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {(view === 'overview' || view === 'schedule') && (
        <div className="grid gap-6 xl:grid-cols-3">
          <SectionCard
            title="Schedule management"
            subtitle="Update appointment status in real-time"
            right={
              <button
                type="button"
                onClick={refreshAll}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw size={13} />
                Refresh
              </button>
            }
          >
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Schedule date</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-triova-500"
              />
            </label>
            {scheduleQuery.isLoading && <p className="text-sm text-slate-500">Loading...</p>}
            {scheduleQuery.isError && <p className="text-sm text-red-500">Error loading schedule</p>}
            {scheduleQuery.data?.appointments?.length === 0 && (
              <p className="text-sm text-slate-500">No appointments on this date.</p>
            )}
            <div className="space-y-3">
              {(scheduleQuery.data?.appointments || []).map((appointment) => (
                <div key={appointment.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-900">
                      {appointment.first_name} {appointment.last_name}
                    </p>
                    <UrgencyBadge value={appointment.urgency} />
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatDate(appointment.appointment_date)} at {formatTime(appointment.appointment_time)}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                    {appointment.chief_complaint || 'General consultation'}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <select
                      value={appointment.status}
                      onChange={(event) =>
                        patchAppointmentStatus(appointment.id, event.target.value as (typeof statusOptions)[number])
                      }
                      disabled={busyKey === `appt-${appointment.id}`}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none"
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                    <Link
                      to={`/doctor/patients/${appointment.patient_id}`}
                      className="text-xs font-semibold text-triova-700 hover:text-triova-900"
                    >
                      Open patient
                    </Link>
                  </div>
                </div>
              ))}
              {!scheduleQuery.data?.appointments.length && (
                <p className="text-sm text-slate-500">No appointments on selected date.</p>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Urgency mix" subtitle="Appointments by urgency" right={<span className="text-xs text-slate-500">{formatDate(selectedDate)}</span>}>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={countsChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fill: '#475569', fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#0f766e" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard title="Recent alerts" subtitle="Acknowledge or resolve active alerts">
            <div className="space-y-3">
              {(dashboardQuery.data?.recent_alerts || []).slice(0, 8).map((alert) => (
                <div key={alert.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {alert.first_name} {alert.last_name}
                    </p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {alert.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{alert.alert_message}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{formatDate(alert.detected_at)}</p>
                  {alert.status === 'active' && (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busyKey === `alert-${alert.id}-acknowledge`}
                        onClick={() => patchAlertStatus(alert.id, 'acknowledge')}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Acknowledge
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === `alert-${alert.id}-resolve`}
                        onClick={() => patchAlertStatus(alert.id, 'resolve')}
                        className="rounded-lg bg-triova-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-triova-900"
                      >
                        Resolve
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!dashboardQuery.data?.recent_alerts.length && <p className="text-sm text-slate-500">No active alerts.</p>}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
