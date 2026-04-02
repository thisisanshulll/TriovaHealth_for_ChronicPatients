import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import patientsRoutes from './routes/patients.routes.js';
import { logger } from '../shared/utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3008;

app.use(cors());
app.use(express.json());

app.use('/api/patients', patientsRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'patients-service', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  logger.info(`Patients service running on port ${PORT}`);
});

export default app;
