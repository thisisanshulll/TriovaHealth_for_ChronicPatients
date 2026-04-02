import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
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
import analyticsRoutes from './analytics/routes/analytics.routes.js';
import notificationsRoutes from './notifications/routes/notifications.routes.js';
import wearablesRoutes from './wearables/routes/wearables.routes.js';
import patientsRoutes from './patients/routes/patients.routes.js';
import doctorsRoutes from './doctors/routes/doctors.routes.js';
import consultationsRoutes from './doctors/routes/consultations.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoEnvPath = path.resolve(__dirname, '../../../.env');
// Load repo-root env for workspace runs (`npm run dev -w @triova/gateway`).
dotenv.config({ path: repoEnvPath });
// Allow optional package-local overrides if present.
dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
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
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/wearables', wearablesRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api/doctors', doctorsRoutes);
app.use('/api/consultations', consultationsRoutes);

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

  new CronJob('*/30 * * * *', async () => {
    /* medication reminders — notify patients */
    const r = await pool.query(
      `SELECT mr.*, pm.medication_name, pm.is_active AS med_active, pm.end_date, p.user_id
       FROM medication_reminders mr
       JOIN patient_medications pm ON pm.id = mr.medication_id
       JOIN patients p ON p.id = mr.patient_id
       WHERE mr.is_active = true`
    );
    for (const row of r.rows) {
      if (!row.med_active) continue;
      if (row.end_date && new Date(row.end_date) < new Date()) continue;
      await pool.query(
        `INSERT INTO notifications (user_id, notification_type, title, message, sent_at)
         VALUES ($1,'medication',$2,$3,NOW())`,
        [row.user_id, 'Medication reminder', `Time to take ${row.medication_name}`]
      );
    }
  }).start();
}

startDocumentWorker();

httpServer.listen(PORT, () => {
  logger.info(`TRIOVA gateway listening on ${PORT}`);
});
