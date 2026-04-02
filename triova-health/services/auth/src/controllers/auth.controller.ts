import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../../shared/db/pool.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../../shared/middleware/auth.middleware.js';
import { ok, err } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

export const registerPatient = async (req: Request, res: Response) => {
  try {
    const { email, password, first_name, last_name, date_of_birth, gender, phone, preferred_language } = req.body;

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return err(res, 'Email already registered', 400);
    }

    const password_hash = await bcrypt.hash(password, 10);

    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'patient') RETURNING id`,
      [email, password_hash]
    );
    const userId = userResult.rows[0].id;

    const patientResult = await pool.query(
      `INSERT INTO patients (user_id, first_name, last_name, date_of_birth, gender, phone, preferred_language)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, first_name, last_name, date_of_birth, gender, phone, preferred_language || 'en']
    );
    const patientId = patientResult.rows[0].id;

    const accessToken = signAccessToken({ sub: userId, email, role: 'patient', patientId });
    const refreshToken = signRefreshToken({ sub: userId });

    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, userId]);

    logger.info('Patient registered', { userId, patientId });

    return ok(res, {
      user: { id: userId, email, role: 'patient' },
      patient: { id: patientId, first_name, last_name },
      tokens: { accessToken, refreshToken }
    }, 201);
  } catch (error) {
    logger.error('Registration failed', { error });
    return err(res, 'Registration failed', 500);
  }
};

export const registerDoctor = async (req: Request, res: Response) => {
  try {
    const { email, password, first_name, last_name, phone, specialization, license_number, qualification, experience_years } = req.body;

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return err(res, 'Email already registered', 400);
    }

    const existingLicense = await pool.query('SELECT id FROM doctors WHERE license_number = $1', [license_number]);
    if (existingLicense.rows.length > 0) {
      return err(res, 'License number already registered', 400);
    }

    const password_hash = await bcrypt.hash(password, 10);

    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'doctor') RETURNING id`,
      [email, password_hash]
    );
    const userId = userResult.rows[0].id;

    const doctorResult = await pool.query(
      `INSERT INTO doctors (user_id, first_name, last_name, phone, specialization, license_number, qualification, experience_years)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [userId, first_name, last_name, phone, specialization, license_number, qualification, experience_years]
    );
    const doctorId = doctorResult.rows[0].id;

    const accessToken = signAccessToken({ sub: userId, email, role: 'doctor', doctorId });
    const refreshToken = signRefreshToken({ sub: userId });

    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, userId]);

    logger.info('Doctor registered', { userId, doctorId });

    return ok(res, {
      user: { id: userId, email, role: 'doctor' },
      doctor: { id: doctorId, first_name, last_name, specialization },
      tokens: { accessToken, refreshToken }
    }, 201);
  } catch (error) {
    logger.error('Doctor registration failed', { error });
    return err(res, 'Registration failed', 500);
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return err(res, 'Invalid credentials', 401);
    }

    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return err(res, 'Invalid credentials', 401);
    }

    let profile = null;
    let patientId: string | undefined;
    let doctorId: string | undefined;

    if (user.role === 'patient') {
      const patientResult = await pool.query('SELECT * FROM patients WHERE user_id = $1', [user.id]);
      if (patientResult.rows.length > 0) {
        profile = patientResult.rows[0];
        patientId = profile.id;
      }
    } else if (user.role === 'doctor') {
      const doctorResult = await pool.query('SELECT * FROM doctors WHERE user_id = $1', [user.id]);
      if (doctorResult.rows.length > 0) {
        profile = doctorResult.rows[0];
        doctorId = profile.id;
      }
    }

    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      patientId,
      doctorId
    });
    const refreshToken = signRefreshToken({ sub: user.id });

    await pool.query('UPDATE users SET refresh_token = $1, last_login_at = NOW() WHERE id = $2', [refreshToken, user.id]);

    logger.info('User logged in', { userId: user.id, role: user.role });

    return ok(res, {
      user: { id: user.id, email, role: user.role },
      profile,
      tokens: { accessToken, refreshToken }
    });
  } catch (error) {
    logger.error('Login failed', { error });
    return err(res, 'Login failed', 500);
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return err(res, 'Refresh token required', 400);
    }

    const decoded = verifyToken(refreshToken);
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1 AND refresh_token = $2', [decoded.sub, refreshToken]);
    
    if (userResult.rows.length === 0) {
      return err(res, 'Invalid refresh token', 401);
    }

    const user = userResult.rows[0];
    let patientId: string | undefined;
    let doctorId: string | undefined;

    if (user.role === 'patient') {
      const patientResult = await pool.query('SELECT id FROM patients WHERE user_id = $1', [user.id]);
      if (patientResult.rows[0]) patientId = patientResult.rows[0].id;
    } else if (user.role === 'doctor') {
      const doctorResult = await pool.query('SELECT id FROM doctors WHERE user_id = $1', [user.id]);
      if (doctorResult.rows[0]) doctorId = doctorResult.rows[0].id;
    }

    const newAccessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      patientId,
      doctorId
    });
    const newRefreshToken = signRefreshToken({ sub: user.id });

    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [newRefreshToken, user.id]);

    return ok(res, { accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (error) {
    logger.error('Token refresh failed', { error });
    return err(res, 'Token refresh failed', 401);
  }
};

export const getMe = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const userResult = await pool.query('SELECT id, email, role, is_verified, created_at FROM users WHERE id = $1', [user.id]);
    
    if (userResult.rows.length === 0) {
      return err(res, 'User not found', 404);
    }

    let profile = null;
    if (user.role === 'patient') {
      const patientResult = await pool.query('SELECT * FROM patients WHERE user_id = $1', [user.id]);
      if (patientResult.rows.length > 0) profile = patientResult.rows[0];
    } else if (user.role === 'doctor') {
      const doctorResult = await pool.query('SELECT * FROM doctors WHERE user_id = $1', [user.id]);
      if (doctorResult.rows.length > 0) profile = doctorResult.rows[0];
    }

    return ok(res, { user: userResult.rows[0], profile });
  } catch (error) {
    logger.error('GetMe failed', { error });
    return err(res, 'Failed to get user', 500);
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    await pool.query('UPDATE users SET refresh_token = NULL WHERE id = $1', [user.id]);
    return ok(res, { message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout failed', { error });
    return err(res, 'Logout failed', 500);
  }
};
