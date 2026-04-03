import { useEffect, useMemo, useState } from 'react';
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
import { useSocket } from '@/hooks/useSocket';

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

  const socket = useSocket(); // <-- GET SOCKET

  // --- Real-time crisis simulation ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [liveCrisis, setLiveCrisis] = useState<any>(null);
  const [localSpikes, setLocalSpikes] = useState<any[]>([]);

  useEffect(() => {
    if (!socket) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleEmergencyUpdate = (payload: any) => {
      if (payload.active && Date.now() - payload.timestamp < 10000) {
        setLiveCrisis(payload);
        
        setLocalSpikes((prev) => {
          const exists = prev.some((s) => s.patientId === payload.patientId && Date.now() - s.timestamp < 90000);
          if (!exists) {
            return [
              {
                id: crypto.randomUUID(),
                patientId: payload.patientId,
                patientName: payload.patientName,
                timestamp: Date.now(),
                message: `Critical vitals spike: HR ${payload.vitals.hr} bpm, SpO2 ${payload.vitals.spo2}%, BP ${payload.vitals.systolic}/${payload.vitals.diastolic}`,
              },
              ...prev
            ];
          }
          return prev;
        });

      } else {
        setLiveCrisis(null);
      }
    };

    socket.on('emergency_vitals_update', handleEmergencyUpdate);

    return () => {
      socket.off('emergency_vitals_update', handleEmergencyUpdate);
    };
  }, [socket]);

  // --- Triage summary notifications ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [triageReports, setTriageReports] = useState<any[]>([]);
  const [expandedSoap, setExpandedSoap] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleTriageSummary = (payload: any) => {
      setTriageReports((prev) => {
        const already = prev.some((r) => r.session_id === payload.session_id);
        if (already) return prev;
        // Sort: CRITICAL first
        const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };
        return [...prev, payload].sort(
          (a, b) => (order[a.risk_level] ?? 4) - (order[b.risk_level] ?? 4)
        );
      });
    };

    socket.on('triage_summary_ready', handleTriageSummary);
    return () => { socket.off('triage_summary_ready', handleTriageSummary); };
  }, [socket]);
  // ------------------------------------

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

  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; email?: string; picture?: string }>({ connected: false });

  const googleStatusQuery = useQuery({
    queryKey: ['google-calendar-status'],
    queryFn: async () => {
      const res = await api.get<{ connected: boolean; google_email?: string; google_picture?: string }>('/auth/google/status');
      return { 
        connected: res.data.connected,
        email: res.data.google_email,
        picture: res.data.google_picture
      };
    },
  });

  useMemo(() => {
    if (googleStatusQuery.data !== undefined) {
      setGoogleStatus(googleStatusQuery.data);
    }
  }, [googleStatusQuery.data]);

  async function connectGoogleCalendar() {
    try {
      const res = await api.post<{ url: string; state: string }>('/auth/google/connect');
      // Backend embeds the userId as state in the URL already
      window.location.href = res.data.url;
    } catch (error) {
      console.error('Failed to get Google auth URL:', error);
      setMessage('Failed to initiate Google Calendar connection. Please try again.');
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
      {liveCrisis && (
        <div className="rounded-3xl border-2 border-red-500 bg-[#fcebeb] p-6 shadow-2xl transition-all duration-300">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-3 text-xl font-bold text-red-900">
              <span className="flex h-10 w-10 animate-pulse items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-500/40">
                <AlertTriangle size={24} />
              </span>
              SMARTWATCH EMERGENCY ALERT
            </p>
            <span className="rounded-xl bg-red-600 px-4 py-1.5 text-sm font-black tracking-wide text-white shadow-md">
              IMMEDIATE ATTENTION REQUIRED
            </span>
          </div>
          <p className="mt-3 text-lg font-medium text-red-900 border-l-4 border-red-500 pl-4 py-1">
            Patient <strong className="font-extrabold">{liveCrisis.patientName}</strong>'s vitals have crossed critical thresholds.
          </p>
          
          <div className="mt-4 flex flex-wrap gap-4 rounded-2xl border border-red-300 bg-red-200/40 p-4">
            <div className="flex flex-col">
              <span className="text-xs font-bold uppercase tracking-wider text-red-800">Heart Rate</span>
              <span className="text-2xl font-black text-red-900">{liveCrisis.vitals.hr} <span className="text-base font-bold">bpm</span></span>
            </div>
            <div className="h-10 w-px bg-red-300"></div>
            <div className="flex flex-col">
              <span className="text-xs font-bold uppercase tracking-wider text-red-800">SpO2</span>
              <span className="text-2xl font-black text-red-900">{liveCrisis.vitals.spo2} <span className="text-base font-bold">%</span></span>
            </div>
            <div className="h-10 w-px bg-red-300"></div>
            <div className="flex flex-col">
              <span className="text-xs font-bold uppercase tracking-wider text-red-800">Blood Pressure</span>
              <span className="text-2xl font-black text-red-900">{liveCrisis.vitals.systolic}/{liveCrisis.vitals.diastolic}</span>
            </div>
          </div>
          
          <div className="mt-5 flex gap-3">
            <Link to={`/doctor/patients/${liveCrisis.patientId || 'patient-123'}`} className="rounded-xl bg-red-600 px-6 py-2.5 font-bold text-white shadow border border-red-700 hover:bg-red-700 transition">
              View Patient Chart
            </Link>
            <button className="rounded-xl bg-white border border-red-400 px-6 py-2.5 font-bold text-red-800 shadow-sm hover:bg-red-50 hover:border-red-500 transition">
              Dispatch Ambulance
            </button>
          </div>
        </div>
      )}

      {criticalAlerts.length > 0 && !liveCrisis && (
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500">Google Calendar</p>
            {googleStatus.connected ? (
              <div className="mt-2 flex items-center gap-3">
                {googleStatus.picture ? (
                  <img src={googleStatus.picture} alt="DP" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full shadow-sm border border-slate-100" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">G</div>
                )}
                <div>
                  <p className="text-sm font-bold text-slate-800">Connected</p>
                  {googleStatus.email && <p className="text-[10px] text-slate-500 truncate max-w-[100px]">{googleStatus.email}</p>}
                </div>
              </div>
            ) : (
              <p className="mt-1 text-sm text-slate-700">Not connected</p>
            )}
          </div>
          {!googleStatus.connected && (
            <button
              type="button"
              onClick={connectGoogleCalendar}
              className="mt-2 inline-flex self-start items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <ExternalLink size={12} />
              Connect
            </button>
          )}
        </div>
      </div>

      {/* NEW: Weekly Triage Reports */}
      {triageReports.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Weekly Triage Reports</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {triageReports.map((report) => {
              const bg = report.risk_level === 'CRITICAL' ? 'bg-[#E24B4A] text-white' :
                         report.risk_level === 'HIGH' ? 'bg-[#D85A30] text-white' :
                         report.risk_level === 'MODERATE' ? 'bg-[#EF9F27] text-slate-900' :
                         'bg-[#1D9E75] text-white';
              
              return (
                <div key={report.session_id} className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className={`px-4 py-3 flex justify-between items-center ${bg}`}>
                    <div>
                      <p className="font-bold">{report.patient_name}</p>
                      <p className="text-xs opacity-90 capitalize text-inherit">{report.disease} check-in</p>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded bg-white/20">
                      {report.risk_level} RISK
                    </span>
                  </div>
                  <div className="p-4 space-y-3 bg-slate-50">
                    {report.key_concerns?.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Key concerns</p>
                        <ul className="text-sm text-slate-700 space-y-1">
                          {report.key_concerns.map((c: string, i: number) => (
                            <li key={i} className="flex gap-1.5"><span className="text-red-400">•</span> {c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <button
                        onClick={() => setExpandedSoap(expandedSoap === report.session_id ? null : report.session_id)}
                        className="text-xs font-bold text-triova-700 hover:text-triova-900"
                      >
                        {expandedSoap === report.session_id ? 'Hide full summary ▲' : 'View full summary ▼'}
                      </button>
                      {expandedSoap === report.session_id && report.soap && (
                        <div className="mt-2 space-y-2 rounded-xl bg-white border border-slate-200 p-3 text-xs text-slate-700">
                          {Object.entries(report.soap).map(([key, value]) => (
                            <div key={key}>
                              <p className="font-bold text-slate-500 uppercase">{key}</p>
                              <p>{value as string}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
              {/* Render locally persisted live crisis spikes */}
              {localSpikes.map((spike) => (
                <div key={spike.id} className="rounded-xl border border-red-200 bg-red-50 p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-red-900">
                      {spike.patientName}
                    </p>
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-800 border border-red-200">
                      Smartwatch Spike
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-red-800">{spike.message}</p>
                  <p className="mt-2 text-[11px] font-semibold text-red-700">{formatTime(new Date(spike.timestamp).toISOString())} (auto-recorded)</p>
                </div>
              ))}

              {/* Render standard DB alerts */}
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
              {!dashboardQuery.data?.recent_alerts.length && !localSpikes.length && <p className="text-sm text-slate-500">No active alerts.</p>}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
