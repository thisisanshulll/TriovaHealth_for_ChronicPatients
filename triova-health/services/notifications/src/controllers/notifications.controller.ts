import { Request, Response } from 'express';
import { pool } from '../../shared/db/pool.js';
import { ok, err } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

export const getUserNotifications = async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const user = (req as any).user;
    const { is_read, type, limit = 20, offset = 0 } = req.query;

    if (user.id !== user_id) return err(res, 'Forbidden', 403);

    let query = `SELECT * FROM notifications WHERE user_id = $1`;
    const params: any[] = [user_id];

    if (is_read !== undefined) {
      query += ` AND is_read = $${params.length + 1}`;
      params.push(is_read === 'true');
    }
    if (type) {
      query += ` AND notification_type = $${params.length + 1}`;
      params.push(type);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const unreadCount = await pool.query(
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`,
      [user_id]
    );

    return ok(res, { 
      notifications: result.rows, 
      unread_count: parseInt(unreadCount.rows[0].count),
      total: result.rows.length 
    });
  } catch (error) {
    logger.error('Get notifications failed', { error });
    return err(res, 'Failed to get notifications', 500);
  }
};

export const markAsRead = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;

    const result = await pool.query(
      `UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, user.id]
    );

    return ok(res, { notification: result.rows[0] });
  } catch (error) {
    logger.error('Mark as read failed', { error });
    return err(res, 'Failed to mark as read', 500);
  }
};

export const markAllAsRead = async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const user = (req as any).user;

    if (user.id !== user_id) return err(res, 'Forbidden', 403);

    const result = await pool.query(
      `UPDATE notifications SET is_read = true, read_at = NOW() WHERE user_id = $1 AND is_read = false`,
      [user_id]
    );

    return ok(res, { updated_count: result.rowCount });
  } catch (error) {
    logger.error('Mark all as read failed', { error });
    return err(res, 'Failed to mark all as read', 500);
  }
};

export const deleteNotification = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;

    await pool.query(`DELETE FROM notifications WHERE id = $1 AND user_id = $2`, [id, user.id]);

    return ok(res, { message: 'Notification deleted' });
  } catch (error) {
    logger.error('Delete notification failed', { error });
    return err(res, 'Failed to delete', 500);
  }
};

export const getMedicationReminders = async (req: Request, res: Response) => {
  try {
    const { patient_id } = req.params;

    const reminders = await pool.query(
      `SELECT mr.*, pm.medication_name, pm.dosage, pm.frequency 
       FROM medication_reminders mr
       JOIN patient_medications pm ON mr.medication_id = pm.id
       WHERE mr.patient_id = $1 AND mr.is_active = true
       ORDER BY mr.reminder_time`,
      [patient_id]
    );

    return ok(res, { reminders: reminders.rows });
  } catch (error) {
    logger.error('Get reminders failed', { error });
    return err(res, 'Failed to get reminders', 500);
  }
};

export const updateReminder = async (req: Request, res: Response) => {
  try {
    const { reminder_id } = req.params;
    const { is_active, reminder_time } = req.body;

    let query = 'UPDATE medication_reminders SET';
    const params: any[] = [];
    const updates: string[] = [];

    if (is_active !== undefined) {
      params.push(is_active);
      updates.push(`is_active = $${params.length}`);
    }
    if (reminder_time) {
      params.push(reminder_time);
      updates.push(`reminder_time = $${params.length}`);
    }

    params.push(reminder_id);
    query += ` ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`;

    const result = await pool.query(query, params);

    return ok(res, { reminder: result.rows[0] });
  } catch (error) {
    logger.error('Update reminder failed', { error });
    return err(res, 'Failed to update reminder', 500);
  }
};

export const createReminder = async (req: Request, res: Response) => {
  try {
    const { patient_id, medication_id, reminder_time } = req.body;

    const result = await pool.query(
      `INSERT INTO medication_reminders (patient_id, medication_id, reminder_time) VALUES ($1, $2, $3) RETURNING *`,
      [patient_id, medication_id, reminder_time]
    );

    return ok(res, { reminder: result.rows[0] }, 201);
  } catch (error) {
    logger.error('Create reminder failed', { error });
    return err(res, 'Failed to create reminder', 500);
  }
};

export const createNotification = async (userId: string, type: string, title: string, message: string, severity = 'info', relatedEntityId?: string, relatedEntityType?: string) => {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, notification_type, title, message, severity, related_entity_id, related_entity_type) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, type, title, message, severity, relatedEntityId, relatedEntityType]
    );
  } catch (error) {
    logger.error('Create notification failed', { error });
  }
};
