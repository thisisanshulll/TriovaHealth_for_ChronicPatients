import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '@/api/axios-instance';
import { useAuthStore } from '@/store/auth.store';

interface LoginResponse {
  user: { id: string };
  role: 'patient' | 'doctor';
  profile?: { id?: string };
  tokens: { accessToken: string; refreshToken: string };
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
      const tokens = data.tokens;
      const role = data.role;
      const profile = data.profile;
      setAuth({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userId: data.user.id,
        role,
        patientId: profile?.id && role === 'patient' ? profile.id : undefined,
        doctorId: profile?.id && role === 'doctor' ? profile.id : undefined,
      });
      navigate(role === 'doctor' ? '/doctor' : '/patient');
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h1 className="text-2xl font-semibold text-triova-900 mb-1">TRIOVA Health</h1>
        <p className="text-slate-600 text-sm mb-6">Sign in to continue</p>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="w-full bg-triova-700 text-white rounded-lg py-2.5 font-medium hover:bg-triova-900 transition"
          >
            Sign in
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          No account?{' '}
          <Link to="/register" className="text-triova-700 font-medium">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
