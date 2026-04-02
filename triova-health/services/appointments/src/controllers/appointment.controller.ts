import { Request, Response } from 'express';
import { pool } from '../../shared/db/pool.js';
import { ok, err } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

export const bookAppointment = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user;
    if (!user.patientId) return err(res, 'Patient not found', 404);

    const { doctor_id, date, time, urgency = 'routine', chief_complaint, booking_notes } = req.body;

    await client.query('BEGIN');

    const slotCheck = await client.query(
      `SELECT id FROM appointments 
       WHERE doctor_id = $1 AND appointment_date = $2 AND appointment_time = $3 
       AND status NOT IN ('cancelled', 'no_show')`,
      [doctor_id, date, time]
    );
    if (slotCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return err(res, 'Slot not available', 409);
    }

    const unavailCheck = await client.query(
      `SELECT id FROM doctor_unavailability 
       WHERE doctor_id = $1 AND unavailable_date = $2 
       AND (is_full_day = TRUE OR (start_time <= $3 AND end_time > $3))`,
      [doctor_id, date, time]
    );
    if (unavailCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return err(res, 'Doctor not available at this time', 409);
    }

    const queueResult = await client.query(
      `SELECT COALESCE(MAX(queue_position), 0) + 1 as next_pos 
       FROM appointments WHERE doctor_id = $1 AND appointment_date = $2 AND status NOT IN ('cancelled', 'no_show')`,
      [doctor_id, date]
    );
    const queuePosition = queueResult.rows[0].next_pos;

    const appointmentResult = await client.query(
      `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, urgency, chief_complaint, booking_notes, queue_position, booking_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual')
       RETURNING *`,
      [user.patientId, doctor_id, date, time, urgency, chief_complaint, booking_notes, queuePosition]
    );

    await client.query('COMMIT');
    logger.info('Appointment booked', { appointmentId: appointmentResult.rows[0].id, patientId: user.patientId });

    return ok(res, {
      appointment: appointmentResult.rows[0],
      queue_position: queuePosition,
      estimated_wait: queuePosition * 30
    }, 201);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Booking failed', { error });
    return err(res, 'Booking failed', 500);
  } finally {
    client.release();
  }
};

export const getAvailableSlots = async (req: Request, res: Response) => {
  try {
    const { doctor_id, date, urgency } = req.query;

    const dayOfWeek = new Date(date as string).getDay();

    const availability = await pool.query(
      `SELECT start_time, end_time, slot_duration_minutes FROM doctor_availability
       WHERE doctor_id = $1 AND day_of_week = $2 AND is_active = TRUE`,
      [doctor_id, dayOfWeek]
    );

    if (availability.rows.length === 0) {
      return ok(res, { slots: [] });
    }

    const bookedSlots = await pool.query(
      `SELECT appointment_time FROM appointments 
       WHERE doctor_id = $1 AND appointment_date = $2 AND status NOT IN ('cancelled', 'no_show')`,
      [doctor_id, date]
    );
    const bookedTimes = new Set(bookedSlots.rows.map(r => r.appointment_time));

    const unavail = await pool.query(
      `SELECT start_time, end_time FROM doctor_unavailability 
       WHERE doctor_id = $1 AND unavailable_date = $2 AND is_full_day = FALSE`,
      [doctor_id, date]
    );

    const slots = [];
    const avail = availability.rows[0];
    let current = avail.start_time;
    const end = avail.end_time;
    const dur = avail.slot_duration_minutes || 30;

    while (current < end) {
      const isBooked = bookedTimes.has(current);
      const isUnavail = unavail.rows.some(u => u.start_time <= current && u.end_time > current);
      
      if (!isBooked && !isUnavail) {
        slots.push({ time: current, is_available: true });
      }
      current = new Date(current.getTime() + dur * 60000);
    }

    return ok(res, { slots });
  } catch (error) {
    logger.error('Get slots failed', { error });
    return err(res, 'Failed to get slots', 500);
  }
};

export const getPatientAppointments = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { patient_id } = req.params;
    const { status, from_date, to_date, limit = 20, offset = 0 } = req.query;

    if (user.patientId !== patient_id && user.role !== 'doctor') {
      return err(res, 'Forbidden', 403);
    }

    let query = `SELECT * FROM appointments WHERE patient_id = $1`;
    const params: any[] = [patient_id];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }
    if (from_date) {
      query += ` AND appointment_date >= $${params.length + 1}`;
      params.push(from_date);
    }
    if (to_date) {
      query += ` AND appointment_date <= $${params.length + 1}`;
      params.push(to_date);
    }

    query += ` ORDER BY appointment_date DESC, appointment_time DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return ok(res, { 
      appointments: result.rows, 
      total: result.rows.length 
    });
  } catch (error) {
    logger.error('Get appointments failed', { error });
    return err(res, 'Failed to get appointments', 500);
  }
};

export const getDoctorAppointments = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { doctor_id } = req.params;
    const { date, status, urgency, limit = 50, offset = 0 } = req.query;

    if (user.doctorId !== doctor_id && user.role !== 'admin') {
      return err(res, 'Forbidden', 403);
    }

    let query = `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name 
                 FROM appointments a 
                 JOIN patients p ON a.patient_id = p.id 
                 WHERE a.doctor_id = $1`;
    const params: any[] = [doctor_id];

    if (date) {
      query += ` AND a.appointment_date = $${params.length + 1}`;
      params.push(date);
    }
    if (status) {
      query += ` AND a.status = $${params.length + 1}`;
      params.push(status);
    }
    if (urgency) {
      query += ` AND a.urgency = $${params.length + 1}`;
      params.push(urgency);
    }

    query += ` ORDER BY a.urgency DESC, a.queue_position ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const counts = await pool.query(
      `SELECT urgency, COUNT(*) as count FROM appointments 
       WHERE doctor_id = $1 AND appointment_date = $2 AND status NOT IN ('cancelled', 'no_show')
       GROUP BY urgency`,
      [doctor_id, date]
    );

    return ok(res, { 
      appointments: result.rows, 
      counts: { emergency: 0, urgent: 0, routine: 0, total: result.rows.length,
        ...Object.fromEntries(counts.rows.map(c => [c.urgency, parseInt(c.count)])) }
    });
  } catch (error) {
    logger.error('Get doctor appointments failed', { error });
    return err(res, 'Failed to get appointments', 500);
  }
};

export const updateAppointmentStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, cancellation_reason } = req.body;

    const result = await pool.query(
      `UPDATE appointments SET status = $1, cancellation_reason = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [status, cancellation_reason, id]
    );

    if (result.rows.length === 0) {
      return err(res, 'Appointment not found', 404);
    }

    return ok(res, { appointment: result.rows[0] });
  } catch (error) {
    logger.error('Update status failed', { error });
    return err(res, 'Failed to update status', 500);
  }
};

export const cancelAppointment = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { reason } = req.body;

    const apptResult = await pool.query('SELECT * FROM appointments WHERE id = $1', [id]);
    if (apptResult.rows.length === 0) {
      return err(res, 'Appointment not found', 404);
    }

    const appt = apptResult.rows[0];
    const appointmentTime = new Date(`${appt.appointment_date}T${appt.appointment_time}`);
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);

    if (appointmentTime < twoHoursFromNow && appt.patient_id !== user.patientId && user.role !== 'doctor') {
      return err(res, 'Appointments can only be cancelled up to 2 hours before the scheduled time', 400);
    }

    const result = await pool.query(
      `UPDATE appointments SET status = 'cancelled', cancellation_reason = $1, cancelled_by = $2, cancelled_at = NOW(), updated_at = NOW() 
       WHERE id = $3 RETURNING *`,
      [reason, user.id, id]
    );

    return ok(res, { appointment: result.rows[0] });
  } catch (error) {
    logger.error('Cancel appointment failed', { error });
    return err(res, 'Failed to cancel appointment', 500);
  }
};

export const getQueueStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT queue_position, status, estimated_wait_minutes FROM appointments WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return err(res, 'Appointment not found', 404);
    }

    const aheadResult = await pool.query(
      `SELECT COUNT(*) as ahead FROM appointments 
       WHERE appointment_date = (SELECT appointment_date FROM appointments WHERE id = $1)
       AND queue_position < (SELECT queue_position FROM appointments WHERE id = $1)
       AND status NOT IN ('cancelled', 'no_show')`,
      [id]
    );

    return ok(res, {
      position: result.rows[0].queue_position,
      ahead_count: parseInt(aheadResult.rows[0].ahead),
      estimated_wait_minutes: result.rows[0].estimated_wait_minutes,
      status: result.rows[0].status
    });
  } catch (error) {
    logger.error('Get queue status failed', { error });
    return err(res, 'Failed to get queue status', 500);
  }
};

export const getNextAvailableSlot = async (req: Request, res: Response) => {
  try {
    const { doctor_id, from_date, urgency = 'routine' } = req.query;

    const result = await pool.query(
      `SELECT slot_date, slot_time FROM get_next_available_slot($1, $2, $3)`,
      [doctor_id, from_date || new Date().toISOString(), urgency]
    );

    if (result.rows.length === 0) {
      return ok(res, { next_slot: null });
    }

    return ok(res, { 
      next_slot: { 
        date: result.rows[0].slot_date, 
        time: result.rows[0].slot_time 
      }
    });
  } catch (error) {
    logger.error('Get next slot failed', { error });
    return err(res, 'Failed to get next slot', 500);
  }
};
