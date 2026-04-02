import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { pool, logger } from '@triova/shared';

let io: Server | null = null;

export function initSocket(httpServer: HttpServer, corsOrigin: string) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
  });
  io.on('connection', (socket) => {
    socket.on('join_appointment_queue', (p: { appointment_id: string }) => {
      socket.join(`appointment:${p.appointment_id}`);
    });
    socket.on('leave_appointment_queue', (p: { appointment_id: string }) => {
      socket.leave(`appointment:${p.appointment_id}`);
    });
    
    socket.on('rejoin_rooms', async (p: { user_id: string; role: string }) => {
      socket.join(`user:${p.user_id}`);
      if (p.role === 'doctor') {
        socket.join('role:doctor');
        try {
          const res = await pool.query('SELECT id FROM doctors WHERE user_id = $1', [p.user_id]);
          if (res.rows.length > 0) {
            socket.join(`doctor_dashboard:${res.rows[0].id}`);
          }
        } catch (err) {
          logger.error('Failed to map doctor user_id to doctor_id for socket join', err);
        }
      }
    });

    socket.on('patient_crisis', async (payload: { active: boolean, timestamp: number, vitals?: any, patientName: string, patientId: string }) => {
      try {
        if (!payload.patientId) return;
        const res = await pool.query(
          `SELECT doctor_id FROM doctor_patient_assignments WHERE patient_id = $1`,
          [payload.patientId]
        );
        for (const row of res.rows) {
          emitToDoctorDashboard(row.doctor_id, 'emergency_vitals_update', payload);
          logger.info(`[Socket] Routed crisis alert for patient ${payload.patientId} to doctor ${row.doctor_id}`);
        }
      } catch (err) {
        logger.error('Failed to route patient_crisis alert', err);
      }
    });
  });
  return io;
}

export function getIO(): Server | null {
  return io;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToAppointment(appointmentId: string, event: string, payload: unknown) {
  io?.to(`appointment:${appointmentId}`).emit(event, payload);
}

export function emitToDoctorDashboard(doctorId: string, event: string, payload: unknown) {
  io?.to(`doctor_dashboard:${doctorId}`).emit(event, payload);
}
