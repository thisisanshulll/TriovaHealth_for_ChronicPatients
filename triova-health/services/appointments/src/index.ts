import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import appointmentRoutes from './routes/appointment.routes.js';
import { logger } from '../shared/utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

app.use('/api/appointments', appointmentRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'appointments-service', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  logger.info(`Appointments service running on port ${PORT}`);
});

export default app;
