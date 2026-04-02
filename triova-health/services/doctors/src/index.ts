import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import doctorsRoutes from './routes/doctors.routes.js';
import consultationsRoutes from './routes/consultations.routes.js';
import { logger } from '../shared/utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3009;

app.use(cors());
app.use(express.json());

app.use('/api/doctors', doctorsRoutes);
app.use('/api/consultations', consultationsRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'doctors-service', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  logger.info(`Doctors service running on port ${PORT}`);
});

export default app;
