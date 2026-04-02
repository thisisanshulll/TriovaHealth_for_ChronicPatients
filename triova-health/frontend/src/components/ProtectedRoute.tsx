import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';

export function ProtectedRoute({ role }: { role: 'patient' | 'doctor' }) {
  const { accessToken, role: r } = useAuthStore();
  if (!accessToken) return <Navigate to="/login" replace />;
  if (r !== role) return <Navigate to="/" replace />;
  return <Outlet />;
}
