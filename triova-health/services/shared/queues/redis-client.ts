import IoRedis from 'ioredis';

const url = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisConn: any = null;

export const getRedisConnection = (): any => {
  if (!redisConn) {
    redisConn = new IoRedis(url, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    redisConn.on('error', () => {});
  }
  return redisConn;
};

export const redisConnection: any = {
  get isReady() { return false; },
  set(key: string, value: string, mode: string, ttl: number, nx: string) { return Promise.resolve(null); },
  del(key: string) { return Promise.resolve(0); },
  on() {},
};

export async function acquireLock(key: string, ttlSec: number): Promise<boolean> {
  const r = await redisConnection.set(key, '1', 'EX', ttlSec, 'NX');
  return r === 'OK';
}

export async function releaseLock(key: string): Promise<void> {
  await redisConnection.del(key);
}
