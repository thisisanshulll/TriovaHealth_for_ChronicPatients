import { Queue } from 'bullmq';
import { redisConnection } from './redis-client.js';

const prefix = '{triova}';

const conn = { connection: redisConnection };

export const documentProcessingQueue = new Queue('document-processing', { ...conn, prefix });
export const emailQueue = new Queue('email-notifications', { ...conn, prefix });
export const smsQueue = new Queue('sms-notifications', { ...conn, prefix });
