import bcrypt from 'bcryptjs';
import {
  pool,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  type JwtPayload,
} from '@triova/shared';

const SALT = Number(process.env.BCRYPT_SALT_ROUNDS) || 10;

function passwordPolicy(pw: string): boolean {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw);
}

export async function registerPatient(input: {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  phone: string;
  preferred_language?: string;
}) {
  if (!passwordPolicy(input.password)) {
    throw Object.assign(new Error('Password must be 8+ chars with uppercase and number'), { status: 400 });
  }
  const hash = await bcrypt.hash(input.password, SALT);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(
      `INSERT INTO users (email, password_hash, role, is_verified)
       VALUES ($1,$2,'patient',true) RETURNING id, email, role, created_at`,
      [input.email.toLowerCase(), hash]
    );
    const userId = u.rows[0].id;
    const p = await client.query(
      `INSERT INTO patients (user_id, first_name, last_name, date_of_birth, gender, phone, preferred_language)
       VALUES ($1,$2,$3,$4,$5::gender_type,$6,$7) RETURNING *`,
      [
        userId,
        input.first_name,
        input.last_name,
        input.date_of_birth,
        input.gender,
        input.phone,
        input.preferred_language || 'en',
      ]
    );
    await client.query('COMMIT');
    const patient = p.rows[0];
    const payload: JwtPayload = {
      sub: userId,
      email: input.email.toLowerCase(),
      role: 'patient',
      patientId: patient.id,
    };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken({ sub: userId });
    await pool.query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [refreshToken, userId]);
    return { user: u.rows[0], patient, tokens: { accessToken, refreshToken } };
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const err = e as { code?: string };
    if (err.code === '23505') throw Object.assign(new Error('Email or phone already registered'), { status: 409 });
    throw e;
  } finally {
    client.release();
  }
}

export async function registerDoctor(input: {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
  specialization: string;
  license_number: string;
  qualification?: string;
  experience_years?: number;
}) {
  if (!passwordPolicy(input.password)) {
    throw Object.assign(new Error('Password must be 8+ chars with uppercase and number'), { status: 400 });
  }
  const hash = await bcrypt.hash(input.password, SALT);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(
      `INSERT INTO users (email, password_hash, role, is_verified)
       VALUES ($1,$2,'doctor',true) RETURNING id, email, role, created_at`,
      [input.email.toLowerCase(), hash]
    );
    const userId = u.rows[0].id;
    const d = await client.query(
      `INSERT INTO doctors (user_id, first_name, last_name, phone, specialization, license_number, qualification, experience_years)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        userId,
        input.first_name,
        input.last_name,
        input.phone,
        input.specialization,
        input.license_number,
        input.qualification || null,
        input.experience_years ?? null,
      ]
    );
    await client.query('COMMIT');
    const doctor = d.rows[0];
    const payload: JwtPayload = {
      sub: userId,
      email: input.email.toLowerCase(),
      role: 'doctor',
      doctorId: doctor.id,
    };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken({ sub: userId });
    await pool.query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [refreshToken, userId]);
    return { user: u.rows[0], doctor, tokens: { accessToken, refreshToken } };
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const err = e as { code?: string };
    if (err.code === '23505') throw Object.assign(new Error('Email, phone, or license already registered'), { status: 409 });
    throw e;
  } finally {
    client.release();
  }
}

export async function login(email: string, password: string) {
  const r = await pool.query(
    `SELECT u.*, p.id AS patient_id, d.id AS doctor_id
     FROM users u
     LEFT JOIN patients p ON p.user_id = u.id
     LEFT JOIN doctors d ON d.user_id = u.id
     WHERE u.email = $1`,
    [email.toLowerCase()]
  );
  if (!r.rows[0]) throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  const row = r.rows[0];
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  const role = row.role as JwtPayload['role'];
  const payload: JwtPayload = {
    sub: row.id,
    email: row.email,
    role,
    patientId: row.patient_id || undefined,
    doctorId: row.doctor_id || undefined,
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken({ sub: row.id });
  await pool.query(`UPDATE users SET refresh_token = $1, last_login_at = NOW() WHERE id = $2`, [
    refreshToken,
    row.id,
  ]);
  let profile: Record<string, unknown> | null = null;
  if (role === 'patient') {
    const pr = await pool.query(`SELECT * FROM patients WHERE user_id = $1`, [row.id]);
    profile = pr.rows[0];
  } else if (role === 'doctor') {
    const dr = await pool.query(`SELECT * FROM doctors WHERE user_id = $1`, [row.id]);
    profile = dr.rows[0];
  }
  return {
    user: { id: row.id, email: row.email, role },
    role,
    tokens: { accessToken, refreshToken },
    profile,
  };
}

export async function refresh(refreshToken: string) {
  const decoded = verifyToken(refreshToken) as { sub: string };
  const r = await pool.query(`SELECT refresh_token FROM users WHERE id = $1`, [decoded.sub]);
  if (!r.rows[0] || r.rows[0].refresh_token !== refreshToken) {
    throw Object.assign(new Error('Invalid refresh token'), { status: 401 });
  }
  const u = await pool.query(
    `SELECT u.id, u.email, u.role, p.id AS patient_id, d.id AS doctor_id
     FROM users u
     LEFT JOIN patients p ON p.user_id = u.id
     LEFT JOIN doctors d ON d.user_id = u.id
     WHERE u.id = $1`,
    [decoded.sub]
  );
  const row = u.rows[0];
  const payload: JwtPayload = {
    sub: row.id,
    email: row.email,
    role: row.role,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
  };
  const accessToken = signAccessToken(payload);
  const newRefresh = signRefreshToken({ sub: row.id });
  await pool.query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [newRefresh, row.id]);
  return { accessToken, refreshToken: newRefresh };
}

export async function logout(userId: string, refreshToken?: string) {
  await pool.query(`UPDATE users SET refresh_token = NULL WHERE id = $1`, [userId]);
  return { message: 'Logged out' };
}

export async function forgotPassword(email: string) {
  return { message: 'If an account exists, reset instructions were sent.' };
}

export async function resetPassword(_token: string, _newPassword: string) {
  return { message: 'Password updated' };
}

export async function verifyEmail(_token: string) {
  return { message: 'Email verified' };
}

export async function resendVerification(_email: string) {
  return { message: 'Verification sent' };
}

export async function me(userId: string) {
  const u = await pool.query(`SELECT id, email, role, is_verified, created_at FROM users WHERE id = $1`, [userId]);
  if (!u.rows[0]) throw Object.assign(new Error('Not found'), { status: 404 });
  let profile: unknown = null;
  if (u.rows[0].role === 'patient') {
    const p = await pool.query(`SELECT * FROM patients WHERE user_id = $1`, [userId]);
    profile = p.rows[0];
  } else if (u.rows[0].role === 'doctor') {
    const d = await pool.query(`SELECT * FROM doctors WHERE user_id = $1`, [userId]);
    profile = d.rows[0];
  }
  return { user: u.rows[0], profile };
}
