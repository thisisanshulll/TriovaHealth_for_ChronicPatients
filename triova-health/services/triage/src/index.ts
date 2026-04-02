import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import triageRoutes from './routes/triage.routes.js';
import { logger } from '../shared/utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

app.use('/api/triage', triageRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'triage-service', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  logger.info(`Triage service running on port ${PORT}`);
});

export default app;
