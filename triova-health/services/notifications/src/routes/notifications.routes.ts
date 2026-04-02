import { Router } from 'express';
import * as notificationsController from '../controllers/notifications.controller.js';
import { authMiddleware } from '../../shared/middleware/auth.middleware.js';

const router = Router();

router.get('/user/:user_id', authMiddleware, notificationsController.getUserNotifications);
router.patch('/:id/read', authMiddleware, notificationsController.markAsRead);
router.patch('/user/:user_id/read-all', authMiddleware, notificationsController.markAllAsRead);
router.delete('/:id', authMiddleware, notificationsController.deleteNotification);
router.get('/reminders/:patient_id', authMiddleware, notificationsController.getMedicationReminders);
router.patch('/reminders/:reminder_id', authMiddleware, notificationsController.updateReminder);
router.post('/reminders', authMiddleware, notificationsController.createReminder);

export default router;
