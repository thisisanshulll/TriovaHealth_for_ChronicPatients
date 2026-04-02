import { pool } from '@triova/shared';

export async function listForUser(userId: string, q: Record<string, string>) {
  const limit = Number(q.limit) || 50;
  const offset = Number(q.offset) || 0;
  let sql = `SELECT * FROM notifications WHERE user_id = $1`;
  const p: unknown[] = [userId];
  let i = 2;
  if (q.is_read === 'true') sql += ` AND is_read = true`;
  if (q.is_read === 'false') sql += ` AND is_read = false`;
  if (q.type) {
    sql += ` AND notification_type = $${i++}::notification_type`;
    p.push(q.type);
  }
  sql += ` ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`;
  p.push(limit, offset);
  const r = await pool.query(sql, p);
  const u = await pool.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false`,
    [userId]
  );
  const t = await pool.query(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1`, [userId]);
  return { notifications: r.rows, unread_count: u.rows[0].n, total: t.rows[0].n };
}

export async function markRead(id: string, userId: string) {
  const r = await pool.query(
    `UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId]
  );
  return r.rows[0];
}

export async function markAllRead(userId: string) {
  const r = await pool.query(
    `UPDATE notifications SET is_read = true, read_at = NOW() WHERE user_id = $1 AND is_read = false`,
    [userId]
  );
  return { updated_count: r.rowCount };
}

export async function removeNotification(id: string, userId: string) {
  await pool.query(`DELETE FROM notifications WHERE id = $1 AND user_id = $2`, [id, userId]);
  return { message: 'Deleted' };
}

export async function remindersForPatient(patientId: string) {
  const r = await pool.query(
    `SELECT mr.*, pm.medication_name FROM medication_reminders mr
     JOIN patient_medications pm ON pm.id = mr.medication_id
     WHERE mr.patient_id = $1`,
    [patientId]
  );
  return {
    reminders: r.rows.map((x: Record<string, unknown>) => ({
      medication: x.medication_name,
      time: x.reminder_time,
      is_active: x.is_active,
      id: x.id,
    })),
  };
}

export async function patchReminder(reminderId: string, patientId: string, body: { is_active?: boolean; reminder_time?: string }) {
  const r = await pool.query(
    `UPDATE medication_reminders SET is_active = COALESCE($3, is_active), reminder_time = COALESCE($4::time, reminder_time)
     WHERE id = $1 AND patient_id = $2 RETURNING *`,
    [reminderId, patientId, body.is_active, body.reminder_time || null]
  );
  return r.rows[0];
}

export async function createReminder(patientId: string, medication_id: string, reminder_time: string) {
  const r = await pool.query(
    `INSERT INTO medication_reminders (patient_id, medication_id, reminder_time) VALUES ($1,$2,$3::time) RETURNING *`,
    [patientId, medication_id, reminder_time]
  );
  return { reminder: r.rows[0] };
}

export async function sendEmailStub(_to: string, _subject: string, _html: string) {
  /* Nodemailer integration when EMAIL_USER set */
}

export async function sendSmsStub(_to: string, _body: string) {
  /* Twilio when TWILIO_ACCOUNT_SID set */
}
