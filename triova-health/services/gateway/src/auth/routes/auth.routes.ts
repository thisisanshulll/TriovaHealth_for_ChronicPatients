import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, loginRateLimit, validateBody, type AuthedRequest } from '@triova/shared';
import * as auth from '../services/auth.service.js';

const router = Router();

const registerPatientSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  date_of_birth: z.string(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']),
  phone: z.string(),
  preferred_language: z.string().optional(),
});

const registerDoctorSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  phone: z.string(),
  specialization: z.string(),
  license_number: z.string(),
  qualification: z.string().optional(),
  experience_years: z.number().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post('/register/patient', loginRateLimit, validateBody(registerPatientSchema), async (req, res, next) => {
  try {
    const data = await auth.registerPatient(req.body);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

router.post('/register/doctor', loginRateLimit, validateBody(registerDoctorSchema), async (req, res, next) => {
  try {
    const data = await auth.registerDoctor(req.body);
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

router.post('/login', loginRateLimit, validateBody(loginSchema), async (req, res, next) => {
  try {
    const data = await auth.login(req.body.email, req.body.password);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.post('/logout', authMiddleware, async (req: AuthedRequest, res, next) => {
  try {
    const data = await auth.logout(req.user!.id, req.body?.refreshToken);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.post('/refresh-token', async (req, res, next) => {
  try {
    const data = await auth.refresh(req.body.refreshToken);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.post('/forgot-password', async (req, res) => {
  res.json(await auth.forgotPassword(req.body.email));
});

router.post('/reset-password', async (req, res) => {
  res.json(await auth.resetPassword(req.body.token, req.body.new_password));
});

router.get('/verify-email/:token', async (req, res) => {
  res.json(await auth.verifyEmail(req.params.token));
});

router.post('/resend-verification', async (req, res) => {
  res.json(await auth.resendVerification(req.body.email));
});

router.get('/me', authMiddleware, async (req: AuthedRequest, res, next) => {
  try {
    res.json(await auth.me(req.user!.id));
  } catch (e) {
    next(e);
  }
});

export default router;
