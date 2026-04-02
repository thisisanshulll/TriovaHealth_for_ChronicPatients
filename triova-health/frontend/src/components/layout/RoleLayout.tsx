import { Outlet } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useSocket } from '@/hooks/useSocket';

export function PatientLayout() {
  useSocket();
  return (
    <AppShell role="patient">
      <Outlet />
    </AppShell>
  );
}

export function DoctorLayout() {
  useSocket();
  return (
    <AppShell role="doctor">
      <Outlet />
    </AppShell>
  );
}
