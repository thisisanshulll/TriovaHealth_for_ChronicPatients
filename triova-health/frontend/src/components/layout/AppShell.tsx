import { ReactNode, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, LogOut, Stethoscope } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/axios-instance';
import { useAuthStore } from '@/store/auth.store';

type Role = 'patient' | 'doctor';

export function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  const location = useLocation();
  const userId = useAuthStore((s) => s.userId);
  const logout = useAuthStore((s) => s.logout);
  const { data } = useQuery({
    queryKey: ['notifications-count', userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await api.get<{ unread_count: number }>(`/notifications/user/${userId}?limit=1`);
      return res.data;
    },
    refetchInterval: 20000,
  });

  const tabs = useMemo(() => {
    if (role === 'patient') {
      return [
        { to: '/patient', label: 'Dashboard', active: location.pathname === '/patient' },
        { to: '/patient/book', label: 'Appointments', active: location.pathname.startsWith('/patient/book') },
        { to: '/patient/triage', label: 'Triage', active: location.pathname.startsWith('/patient/triage') },
        { to: '/patient/records', label: 'Records', active: location.pathname.startsWith('/patient/records') },
      ];
    }

    const params = new URLSearchParams(location.search);
    const view = params.get('view') || 'overview';

    return [
      { to: '/doctor', label: 'Dashboard', active: location.pathname === '/doctor' && view === 'overview' },
      {
        to: '/doctor?view=patients',
        label: 'Patients',
        active: (location.pathname === '/doctor' && view === 'patients') || location.pathname.startsWith('/doctor/patients/'),
      },
      { to: '/doctor?view=schedule', label: 'Schedule', active: location.pathname === '/doctor' && view === 'schedule' },
    ];
  }, [role, location.pathname, location.search]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#dff5f4,_#f8fafc_42%)] text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
          <Link to={role === 'patient' ? '/patient' : '/doctor'} className="flex items-center gap-2">
            <span className="rounded-xl bg-triova-700 p-2 text-white">
              <Stethoscope size={16} />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-wide text-triova-900">TRIOVA Health</p>
              <p className="text-xs text-slate-500">{role === 'patient' ? 'Patient Workspace' : 'Doctor Workspace'}</p>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <div className="relative rounded-xl border border-slate-200 p-2 text-slate-600">
              <Bell size={16} />
              {!!data?.unread_count && (
                <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {data.unread_count}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                logout();
                window.location.href = '/login';
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              <LogOut size={15} />
              Log out
            </button>
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl gap-2 px-4 pb-3 md:px-6">
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab.active ? 'bg-triova-700 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">{children}</main>
    </div>
  );
}
