import { Queue } from 'bullmq';
import { getRedisConnection } from './redis-client.js';

const prefix = '{triova}';

const getConnection = () => {
  try {
    const conn = getRedisConnection();
    return conn;
  } catch {
    return null;
  }
};

const conn = { connection: getConnection() };

export const documentProcessingQueue = new Queue('document-processing', { ...conn, prefix });
export const emailQueue = new Queue('email-notifications', { ...conn, prefix });
export const smsQueue = new Queue('sms-notifications', { ...conn, prefix });
