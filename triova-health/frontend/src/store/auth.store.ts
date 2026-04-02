import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Role = 'patient' | 'doctor' | 'admin';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  role: Role | null;
  patientId: string | null;
  doctorId: string | null;
  setAuth: (data: {
    accessToken: string;
    refreshToken: string;
    userId: string;
    role: Role;
    patientId?: string;
    doctorId?: string;
  }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      userId: null,
      role: null,
      patientId: null,
      doctorId: null,
      setAuth: (data) =>
        set({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          userId: data.userId,
          role: data.role,
          patientId: data.patientId ?? null,
          doctorId: data.doctorId ?? null,
        }),
      logout: () =>
        set({
          accessToken: null,
          refreshToken: null,
          userId: null,
          role: null,
          patientId: null,
          doctorId: null,
        }),
    }),
    { name: 'triova-auth' }
  )
);
