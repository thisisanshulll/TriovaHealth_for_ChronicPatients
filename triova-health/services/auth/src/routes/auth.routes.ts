import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

router.post('/register/patient', authController.registerPatient);
router.post('/register/doctor', authController.registerDoctor);
router.post('/login', authController.login);
router.post('/refresh-token', authController.refreshToken);
router.get('/me', authController.getMe);
router.post('/logout', authController.logout);

export default router;
