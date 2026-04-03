import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoEnvPath = path.resolve(__dirname, '../../../.env');
// Load repo-root env for workspace runs (`npm run dev -w @triova/gateway`).
dotenv.config({ path: repoEnvPath });
// Allow optional package-local overrides if present.
dotenv.config();

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { CronJob } from 'cron';

import { errorMiddleware, logger } from '@triova/shared';
import { initSocket } from './socket-server.js';
import { startDocumentWorker } from './workers/document.worker.js';
import { runDailyTrendsAndAlerts } from './analytics/services/analytics.service.js';
import { pool } from '@triova/shared';

import authRoutes from './auth/routes/auth.routes.js';
import appointmentRoutes from './appointments/routes/appointment.routes.js';
import triageRoutes from './triage/routes/triage.routes.js';
import recordsRoutes from './medical-records/routes/records.routes.js';
import extractMedicationRoutes from './medical-records/routes/extract-medications.routes.js';
import analyticsRoutes from './analytics/routes/analytics.routes.js';
import notificationsRoutes from './notifications/routes/notifications.routes.js';
import wearablesRoutes from './wearables/routes/wearables.routes.js';
import patientsRoutes from './patients/routes/patients.routes.js';
import doctorsRoutes from './doctors/routes/doctors.routes.js';
import consultationsRoutes from './doctors/routes/consultations.routes.js';
import medicationRoutes from './medications/routes/medication.routes.js';



const app = express();
const httpServer = createServer(app);
const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = [
  FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

const uploadsRoot = path.join(process.cwd(), 'uploads');
app.use('/files', express.static(uploadsRoot));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'triova-gateway', timestamp: new Date().toISOString() });
});

const swaggerSpec = swaggerJsdoc({
  definition: { openapi: '3.0.0', info: { title: 'TRIOVA API', version: '1.0.0' } },
  apis: [],
});
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/auth', authRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/triage', triageRoutes);
app.use('/api/medical-records', recordsRoutes);
app.use('/api/medical-records', extractMedicationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/wearables', wearablesRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api/doctors', doctorsRoutes);
app.use('/api/consultations', consultationsRoutes);
app.use('/api/medications', medicationRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorMiddleware);

initSocket(httpServer, FRONTEND_URL);

if (process.env.ENABLE_CRON_JOBS !== 'false') {
  new CronJob('0 * * * *', async () => {
    const { syncMockReading } = await import('./wearables/services/mock-wearable.service.js');
    const r = await pool.query(`SELECT id FROM patients WHERE is_active = true`);
    for (const row of r.rows) {
      try {
        await syncMockReading(row.id);
      } catch (e) {
        logger.warn('Wearable sync failed', e);
      }
    }
  }).start();

  new CronJob('0 8 * * *', async () => {
    try {
      await runDailyTrendsAndAlerts();
    } catch (e) {
      logger.warn('Daily trends failed', e);
    }
  }).start();

  new CronJob('*/5 * * * *', async () => {
    /* medication reminders — notify patients every 5 minutes */
    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMinute = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${currentHour}:${currentMinute}:00`;
    
    const r = await pool.query(
      `SELECT mr.id, mr.medication_id, mr.reminder_time, pm.medication_name, pm.is_active AS med_active, pm.end_date, pm.dosage, pm.timing_instructions, p.user_id
       FROM medication_reminders mr
       JOIN patient_medications pm ON pm.id = mr.medication_id
       JOIN patients p ON p.id = mr.patient_id
       WHERE mr.is_active = true AND pm.is_active = true
       AND mr.reminder_time >= '${currentTime}'::time
       AND mr.reminder_time < '${currentTime}'::time + interval '5 minutes'
       AND (mr.last_sent_at IS NULL OR mr.last_sent_at < NOW() - interval '5 hours')`
    );
    
    logger.info(`Checking medication reminders at ${currentTime}, found ${r.rows.length} due`);
    
    for (const row of r.rows) {
      if (row.end_date && new Date(row.end_date) < new Date()) continue;
      
      const timingMsg = row.timing_instructions ? ` (${row.timing_instructions})` : '';
      const dosageMsg = row.dosage ? ` - ${row.dosage}` : '';
      
      await pool.query(
        `INSERT INTO notifications (user_id, notification_type, title, message, sent_at)
         VALUES ($1, 'medication', $2, $3, NOW())`,
        [row.user_id, '💊 Medication Reminder', `Time to take ${row.medication_name}${dosageMsg}${timingMsg}`]
      );
      
      await pool.query(
        `UPDATE medication_reminders SET last_sent_at = NOW() WHERE id = $1`,
        [row.id]
      );
      
      logger.info(`Sent medication reminder for ${row.medication_name} to user ${row.user_id}`);
    }
  }).start();
}

startDocumentWorker();

httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info(`TRIOVA gateway listening on ${PORT}`);
});
