import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '@/api/axios-instance';
import { useAuthStore } from '@/store/auth.store';

interface RegisterPatientResponse {
  user: { id: string };
  patient: { id: string };
  tokens: { accessToken: string; refreshToken: string };
}

interface RegisterDoctorResponse {
  user: { id: string };
  doctor: { id: string };
  tokens: { accessToken: string; refreshToken: string };
}

export default function Register() {
  const [mode, setMode] = useState<'patient' | 'doctor'>('patient');
  const [form, setForm] = useState({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    phone: '',
    date_of_birth: '1990-01-01',
    gender: 'male',
    specialization: 'General Medicine',
    license_number: 'LIC-001',
  });
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'patient') {
        const { data } = await api.post<RegisterPatientResponse>('/auth/register/patient', {
          email: form.email,
          password: form.password,
          first_name: form.first_name,
          last_name: form.last_name,
          date_of_birth: form.date_of_birth,
          gender: form.gender,
          phone: form.phone,
        });
        setAuth({
          accessToken: data.tokens.accessToken,
          refreshToken: data.tokens.refreshToken,
          userId: data.user.id,
          role: 'patient',
          patientId: data.patient.id,
        });
      } else {
        const { data } = await api.post<RegisterDoctorResponse>('/auth/register/doctor', {
          email: form.email,
          password: form.password,
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone,
          specialization: form.specialization,
          license_number: form.license_number,
        });
        setAuth({
          accessToken: data.tokens.accessToken,
          refreshToken: data.tokens.refreshToken,
          userId: data.user.id,
          role: 'doctor',
          doctorId: data.doctor.id,
        });
      }
      navigate(mode === 'doctor' ? '/doctor' : '/patient');
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-8 border border-slate-100">
        <h1 className="text-2xl font-semibold text-triova-900 mb-4">Create account</h1>
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            className={`flex-1 py-2 rounded-lg ${mode === 'patient' ? 'bg-triova-700 text-white' : 'bg-slate-100'}`}
            onClick={() => setMode('patient')}
          >
            Patient
          </button>
          <button
            type="button"
            className={`flex-1 py-2 rounded-lg ${mode === 'doctor' ? 'bg-triova-700 text-white' : 'bg-slate-100'}`}
            onClick={() => setMode('doctor')}
          >
            Doctor
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            placeholder="Password (8+ chars, uppercase, number)"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              placeholder="First name"
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              required
            />
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              placeholder="Last name"
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              required
            />
          </div>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
          />
          {mode === 'patient' && (
            <>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.date_of_birth}
                onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
              />
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </>
          )}
          {mode === 'doctor' && (
            <>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                placeholder="Specialization"
                value={form.specialization}
                onChange={(e) => setForm({ ...form, specialization: e.target.value })}
              />
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                placeholder="License number"
                value={form.license_number}
                onChange={(e) => setForm({ ...form, license_number: e.target.value })}
              />
            </>
          )}
          <button type="submit" className="w-full bg-triova-700 text-white rounded-lg py-2.5 font-medium">
            Register
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-triova-700">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
