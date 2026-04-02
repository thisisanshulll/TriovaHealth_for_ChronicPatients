export type UserRole = 'patient' | 'doctor' | 'admin';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  patientId?: string;
  doctorId?: string;
  iat?: number;
  exp?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  patientId?: string;
  doctorId?: string;
}
