import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import notificationsRoutes from './routes/notifications.routes.js';
import { logger } from '../shared/utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3006;

app.use(cors());
app.use(express.json());

app.use('/api/notifications', notificationsRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notifications-service', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  logger.info(`Notifications service running on port ${PORT}`);
});

export default app;
