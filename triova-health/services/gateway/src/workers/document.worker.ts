import { Worker, type Job } from 'bullmq';
import { getRedisConnection } from '@triova/shared';
import { processDocumentJob } from '../medical-records/services/records.service.js';
import { logger } from '@triova/shared';

export function startDocumentWorker() {
  const worker = new Worker(
    'document-processing',
    async (job: Job) => {
      if (job.name === 'processDocument') {
        await processDocumentJob(job.data as Parameters<typeof processDocumentJob>[0]);
      }
    },
    { connection: getRedisConnection(), prefix: '{triova}', concurrency: 3 }
  );
  worker.on('failed', (job, err) => logger.error('Document job failed', { jobId: job?.id, err }));
  return worker;
}
