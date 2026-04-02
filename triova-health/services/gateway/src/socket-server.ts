import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';

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
    socket.on('rejoin_rooms', (p: { user_id: string; role: string }) => {
      socket.join(`user:${p.user_id}`);
      if (p.role === 'doctor') socket.join('role:doctor');
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
