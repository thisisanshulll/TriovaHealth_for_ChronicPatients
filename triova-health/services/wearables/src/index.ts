import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import wearablesRoutes from './routes/wearables.routes.js';
import { logger } from '../shared/utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3007;

app.use(cors());
app.use(express.json());

app.use('/api/wearables', wearablesRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'wearables-service', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  logger.info(`Wearables service running on port ${PORT}`);
});

export default app;
