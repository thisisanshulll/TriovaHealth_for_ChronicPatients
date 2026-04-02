import IoRedis from 'ioredis';

const url = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;

/** ioredis typings in some TS setups omit command methods; use loose typing for BullMQ compatibility */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const redisConnection: any = new IoRedis(url, {
  maxRetriesPerRequest: null,
});

export async function acquireLock(key: string, ttlSec: number): Promise<boolean> {
  const r = await redisConnection.set(key, '1', 'EX', ttlSec, 'NX');
  return r === 'OK';
}

export async function releaseLock(key: string): Promise<void> {
  await redisConnection.del(key);
}
