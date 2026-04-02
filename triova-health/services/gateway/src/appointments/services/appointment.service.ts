import { pool } from '@triova/shared';
import { hoursUntilAppointment } from '@triova/shared';
import { runVoiceBooking } from '../agents/VoiceBookingAgent.js';
import { emitToAppointment, emitToUser } from '../../socket-server.js';
import { logger } from '@triova/shared';
import { syncAppointmentToDoctorCalendar } from '../../calendar/google-calendar.service.js';

async function notifyUser(
  userId: string,
  title: string,
  message: string,
  type: 'appointment' | 'message' = 'appointment'
) {
  await pool.query(
    `INSERT INTO notifications (user_id, notification_type, title, message, sent_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [userId, type, title, message]
  );
  emitToUser(userId, 'notification', { type, title, message, severity: 'info' });
}

export async function voiceBooking(patientId: string, userId: string, audio_base64: string) {
  const doc = await pool.query(`SELECT id FROM doctors WHERE is_available = true LIMIT 1`);
  const doctorId = doc.rows[0]?.id;
  if (!doctorId) throw Object.assign(new Error('No doctor available'), { status: 400 });
  return runVoiceBooking(audio_base64, doctorId, patientId);
}

export async function bookAppointment(input: {
  patientId: string;
  patientUserId: string;
  doctor_id: string;
  date: string;
  time: string;
  urgency?: string;
  chief_complaint?: string;
  booking_notes?: string;
  booking_method?: string;
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT id FROM doctors WHERE id = $1 FOR UPDATE`,
      [input.doctor_id]
    );
    const conflict = await client.query(
      `SELECT id FROM appointments WHERE doctor_id = $1 AND appointment_date = $2::date AND appointment_time = $3::time
       AND status NOT IN ('cancelled','no_show') FOR UPDATE`,
      [input.doctor_id, input.date, input.time]
    );
    if (conflict.rows.length) {
      await client.query('ROLLBACK');
      const alts = await nextAlternatives(input.doctor_id, input.date, input.time);
      const err = Object.assign(new Error('Slot unavailable'), { status: 409, alternatives: alts });
      throw err;
    }

    const urg = (input.urgency || 'routine') as string;
    const urgency =
      urg === 'emergency' ? 'emergency' : urg === 'urgent' ? 'urgent' : 'routine';

    if (urgency === 'emergency') {
      await handleEmergencySlot(client, input.doctor_id, input.date, input.patientUserId);
    }

    const qpos = await client.query(
      `SELECT COALESCE(MAX(queue_position),0)+1 AS n FROM appointments WHERE doctor_id = $1 AND appointment_date = $2::date`,
      [input.doctor_id, input.date]
    );
    const queue_position = qpos.rows[0].n;

    const ins = await client.query(
      `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, urgency, chief_complaint, booking_notes, booking_method, queue_position, estimated_wait_minutes, status)
       VALUES ($1,$2,$3::date,$4::time,$5::urgency_level,$6,$7,$8,$9,$10,'scheduled')
       RETURNING *`,
      [
        input.patientId,
        input.doctor_id,
        input.date,
        input.time,
        urgency,
        input.chief_complaint || null,
        input.booking_notes || null,
        input.booking_method || 'manual',
        queue_position,
        Math.min(120, queue_position * 15),
      ]
    );
    await client.query('COMMIT');
    const appt = ins.rows[0];
    const du = await pool.query(`SELECT user_id, first_name, last_name FROM doctors WHERE id = $1`, [input.doctor_id]);
    const patientInfo = await pool.query(`SELECT first_name, last_name FROM patients WHERE id = $1`, [input.patientId]);
    if (du.rows[0]) {
      await notifyUser(
        du.rows[0].user_id,
        'New appointment',
        `Patient booked for ${input.date} ${input.time}`
      );
      await syncAppointmentToDoctorCalendar(du.rows[0].user_id, {
        patientName: `${patientInfo.rows[0]?.first_name} ${patientInfo.rows[0]?.last_name}`,
        date: input.date,
        time: input.time,
        chiefComplaint: input.chief_complaint,
      });
    }
    await notifyUser(input.patientUserId, 'Appointment confirmed', `Your visit is on ${input.date} at ${input.time}`);
    emitToAppointment(appt.id, 'queue_update', {
      appointment_id: appt.id,
      position: queue_position,
      estimated_wait_minutes: appt.estimated_wait_minutes,
    });
    return {
      appointment: appt,
      queue_position,
      estimated_wait: appt.estimated_wait_minutes,
    };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* */
    }
    throw e;
  } finally {
    client.release();
  }
}

async function handleEmergencySlot(
  client: import('pg').PoolClient,
  doctorId: string,
  date: string,
  excludeNotifyUser?: string
) {
  const routine = await client.query(
    `SELECT * FROM appointments WHERE doctor_id = $1 AND appointment_date = $2::date AND urgency = 'routine' AND status IN ('scheduled','confirmed')
     ORDER BY appointment_time ASC LIMIT 1 FOR UPDATE`,
    [doctorId, date]
  );
  if (!routine.rows.length) return;
  const a = routine.rows[0];
  const newTime = new Date(`2000-01-01T${a.appointment_time}`);
  newTime.setMinutes(newTime.getMinutes() + 15);
  const timeStr = newTime.toTimeString().slice(0, 8);
  try {
    await client.query(
      `UPDATE appointments SET appointment_time = $1::time, booking_notes = COALESCE(booking_notes,'') || ' [Rescheduled +15m emergency]'
       WHERE id = $2`,
      [timeStr, a.id]
    );
    const pu = await client.query(`SELECT user_id FROM patients WHERE id = $1`, [a.patient_id]);
    if (pu.rows[0] && pu.rows[0].user_id !== excludeNotifyUser) {
      await notifyUser(
        pu.rows[0].user_id,
        'Appointment adjusted',
        'Your appointment was rescheduled by 15 minutes due to an emergency case.'
      );
    }
  } catch (e) {
    logger.warn('Emergency reschedule skipped', e);
  }
}

async function nextAlternatives(doctorId: string, date: string, _time: string) {
  const r = await pool.query(`SELECT * FROM get_next_available_slot($1, $2::timestamp, 'routine')`, [
    doctorId,
    `${date}T12:00:00`,
  ]);
  const rows = r.rows.slice(0, 3);
  return rows.map((x: { slot_date: string; slot_time: string }) => ({
    date: x.slot_date,
    time: x.slot_time,
  }));
}

export async function getAvailableSlots(doctorId: string, date: string) {
  const r = await pool.query(
    `SELECT appointment_time::text, status FROM appointments
     WHERE doctor_id = $1 AND appointment_date = $2::date AND status NOT IN ('cancelled','no_show')`,
    [doctorId, date]
  );
  const taken = new Set(r.rows.map((x: { appointment_time: string }) => x.appointment_time.slice(0, 8)));
  const avail = await pool.query(
    `SELECT * FROM doctor_availability WHERE doctor_id = $1 AND is_active = true`,
    [doctorId]
  );
  const slots: { time: string; is_available: boolean; remaining_count: number }[] = [];
  const dow = new Date(date + 'T12:00:00').getDay();
  const daySlots = avail.rows.filter((a: { day_of_week: number }) => a.day_of_week === dow);
  for (const a of daySlots) {
    let t = a.start_time;
    const end = a.end_time;
    const dur = a.slot_duration_minutes || 30;
    while (t < end) {
      const ts = String(t).slice(0, 8);
      const free = !taken.has(ts);
      slots.push({ time: ts, is_available: free, remaining_count: free ? 1 : 0 });
      const d = new Date(`2000-01-01T${ts}`);
      d.setMinutes(d.getMinutes() + dur);
      t = d.toTimeString().slice(0, 8);
    }
  }
  return { slots };
}

export async function listPatientAppointments(
  patientId: string,
  q: { status?: string; from_date?: string; to_date?: string; limit?: number; offset?: number }
) {
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;
  let sql = `SELECT a.*, d.first_name AS doctor_first_name, d.last_name AS doctor_last_name, d.specialization
    FROM appointments a
    JOIN doctors d ON d.id = a.doctor_id
    WHERE a.patient_id = $1`;
  const p: unknown[] = [patientId];
  let i = 2;
  if (q.status) {
    sql += ` AND a.status = $${i++}`;
    p.push(q.status);
  }
  if (q.from_date) {
    sql += ` AND a.appointment_date >= $${i++}`;
    p.push(q.from_date);
  }
  if (q.to_date) {
    sql += ` AND a.appointment_date <= $${i++}`;
    p.push(q.to_date);
  }
  sql += ` ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT $${i++} OFFSET $${i++}`;
  p.push(limit, offset);
  const r = await pool.query(sql, p);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = r.rows.filter(
    (a: { appointment_date: string; status: string }) =>
      a.appointment_date >= today && a.status !== 'cancelled' && a.status !== 'completed'
  );
  const past = r.rows.filter(
    (a: { appointment_date: string; status: string }) =>
      a.appointment_date < today || ['completed', 'cancelled', 'no_show'].includes(a.status)
  );
  const c = await pool.query(`SELECT COUNT(*)::int AS n FROM appointments WHERE patient_id = $1`, [patientId]);
  return { upcoming, past, total: c.rows[0].n };
}

export async function listDoctorAppointments(
  doctorId: string,
  q: { date?: string; status?: string; urgency?: string; limit?: number; offset?: number }
) {
  const limit = q.limit ?? 100;
  const offset = q.offset ?? 0;
  let sql = `SELECT a.*, p.first_name, p.last_name FROM appointments a
    JOIN patients p ON p.id = a.patient_id WHERE a.doctor_id = $1`;
  const p: unknown[] = [doctorId];
  let i = 2;
  if (q.date) {
    sql += ` AND a.appointment_date = $${i++}::date`;
    p.push(q.date);
  }
  if (q.status) {
    sql += ` AND a.status = $${i++}`;
    p.push(q.status);
  }
  if (q.urgency) {
    sql += ` AND a.urgency = $${i++}::urgency_level`;
    p.push(q.urgency);
  }
  sql += ` ORDER BY a.appointment_date, a.appointment_time LIMIT $${i++} OFFSET $${i++}`;
  p.push(limit, offset);
  const r = await pool.query(sql, p);
  const counts = await pool.query(
    `SELECT urgency, COUNT(*)::int AS n FROM appointments WHERE doctor_id = $1 AND appointment_date = COALESCE($2::date, CURRENT_DATE) GROUP BY urgency`,
    [doctorId, q.date || null]
  );
  const agg = { emergency: 0, urgent: 0, routine: 0, total: r.rows.length };
  for (const row of counts.rows) {
    if (row.urgency === 'emergency') agg.emergency = row.n;
    if (row.urgency === 'urgent') agg.urgent = row.n;
    if (row.urgency === 'routine') agg.routine = row.n;
  }
  return { appointments: r.rows, counts: agg };
}

export async function patchStatus(
  appointmentId: string,
  status: string,
  cancellation_reason?: string,
  cancelledBy?: string
) {
  const r = await pool.query(
    `UPDATE appointments SET status = $1::appointment_status, cancellation_reason = COALESCE($2, cancellation_reason),
     cancelled_by = COALESCE($3::uuid, cancelled_by), cancelled_at = CASE WHEN $1 IN ('cancelled') THEN NOW() ELSE cancelled_at END
     WHERE id = $4 RETURNING *`,
    [status, cancellation_reason || null, cancelledBy || null, appointmentId]
  );
  return r.rows[0];
}

export async function cancelAppointment(
  appointmentId: string,
  patientId: string | null,
  patientRole: string,
  reason?: string
) {
  const a = await pool.query(`SELECT * FROM appointments WHERE id = $1`, [appointmentId]);
  if (!a.rows[0]) throw Object.assign(new Error('Not found'), { status: 404 });
  const ap = a.rows[0];
  if (patientRole === 'patient' && ap.patient_id !== patientId) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  const hrs = hoursUntilAppointment(ap.appointment_date, ap.appointment_time.slice(0, 8));
  if (patientRole === 'patient' && hrs < 2) {
    throw Object.assign(
      new Error(
        "Appointments can only be cancelled up to 2 hours before the scheduled time. Please contact your doctor's office directly."
      ),
      { status: 400 }
    );
  }
  return patchStatus(appointmentId, 'cancelled', reason, undefined);
}

export async function queueStatus(appointmentId: string, patientId: string) {
  const a = await pool.query(`SELECT * FROM appointments WHERE id = $1 AND patient_id = $2`, [
    appointmentId,
    patientId,
  ]);
  if (!a.rows[0]) throw Object.assign(new Error('Not found'), { status: 404 });
  const ap = a.rows[0];
  const ahead = await pool.query(
    `SELECT COUNT(*)::int AS n FROM appointments WHERE doctor_id = $1 AND appointment_date = $2::date AND queue_position < $3 AND status IN ('scheduled','confirmed','in_progress')`,
    [ap.doctor_id, ap.appointment_date, ap.queue_position || 999999]
  );
  return {
    position: ap.queue_position,
    ahead_count: ahead.rows[0].n,
    estimated_wait_minutes: ap.estimated_wait_minutes,
    status: ap.status,
  };
}

export async function setAvailability(
  doctorId: string,
  body: { day_of_week: number; start_time: string; end_time: string; slot_duration_minutes?: number }
) {
  const r = await pool.query(
    `INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
     VALUES ($1,$2,$3::time,$4::time,$5) RETURNING *`,
    [
      doctorId,
      body.day_of_week,
      body.start_time,
      body.end_time,
      body.slot_duration_minutes || 30,
    ]
  );
  return { availability: r.rows[0] };
}

export async function patchAvailability(
  id: string,
  doctorId: string,
  body: { start_time?: string; end_time?: string; is_active?: boolean; slot_duration_minutes?: number }
) {
  const r = await pool.query(
    `UPDATE doctor_availability SET
      start_time = COALESCE($1::time, start_time),
      end_time = COALESCE($2::time, end_time),
      is_active = COALESCE($3, is_active),
      slot_duration_minutes = COALESCE($4, slot_duration_minutes)
     WHERE id = $5 AND doctor_id = $6 RETURNING *`,
    [body.start_time || null, body.end_time || null, body.is_active, body.slot_duration_minutes, id, doctorId]
  );
  return r.rows[0];
}

export async function addUnavailability(
  doctorId: string,
  body: { date: string; start_time?: string; end_time?: string; is_full_day: boolean; reason?: string }
) {
  const r = await pool.query(
    `INSERT INTO doctor_unavailability (doctor_id, unavailable_date, start_time, end_time, is_full_day, reason)
     VALUES ($1,$2::date,$3::time,$4::time,$5,$6) RETURNING *`,
    [
      doctorId,
      body.date,
      body.start_time || null,
      body.end_time || null,
      body.is_full_day,
      body.reason || null,
    ]
  );
  return r.rows[0];
}

export async function nextAvailable(doctorId: string, fromDate?: string, _urgency?: string) {
  const from = fromDate ? `${fromDate}T09:00:00` : new Date().toISOString().slice(0, 16) + ':00';
  const r = await pool.query(`SELECT * FROM get_next_available_slot($1, $2::timestamp, 'routine')`, [
    doctorId,
    from,
  ]);
  if (!r.rows[0]) return { next_slot: null };
  const row = r.rows[0];
  return { next_slot: { date: row.slot_date, time: row.slot_time } };
}
