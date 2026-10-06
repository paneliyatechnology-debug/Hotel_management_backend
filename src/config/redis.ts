import Redis, { RedisOptions } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Build Redis Connection Options for BullMQ & General Cache
 */
export const getRedisOptions = (): RedisOptions => {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    return {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  }

  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = Number(process.env.REDIS_PORT) || 6379;
  const password = process.env.REDIS_PASSWORD || undefined;

  return {
    host,
    port,
    password,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    connectTimeout: 2500,
    lazyConnect: true,
    retryStrategy: (times: number) => {
      // Don't loop infinitely if Redis is offline locally
      if (times > 3) {
        return null;
      }
      return Math.min(times * 500, 2000);
    },
  };
};

/**
 * Creates a standalone ioredis connection configured for BullMQ
 */
export const createRedisConnection = (): Redis => {
  const redisUrl = process.env.REDIS_URL;
  const options = getRedisOptions();
  const client = redisUrl ? new Redis(redisUrl, options) : new Redis(options);

  // Prevent unhandled error crashes if Redis disconnects
  client.on('error', (err: any) => {
    // Suppress connection refused logs from crashing the app
    if (err?.code !== 'ECONNREFUSED' && err?.code !== 'ENOTFOUND') {
      console.warn('⚠️ [Redis] Connection warning:', err?.message || err);
    }
  });

  return client;
};

let redisAvailabilityCache: boolean | null = null;
let lastCheckTime = 0;

/**
 * Fast ping check to verify if Redis is reachable.
 * Returns true if Redis is online, false if offline.
 */
export const isRedisReachable = async (): Promise<boolean> => {
  const now = Date.now();
  // Cache check result for 30 seconds to avoid ping overhead
  if (redisAvailabilityCache !== null && now - lastCheckTime < 30000) {
    return redisAvailabilityCache;
  }

  let testClient: Redis | null = null;
  try {
    const options = getRedisOptions();
    const redisUrl = process.env.REDIS_URL;
    testClient = redisUrl
      ? new Redis(redisUrl, { ...options, connectTimeout: 1500, lazyConnect: true })
      : new Redis({ ...options, connectTimeout: 1500, lazyConnect: true });

    testClient.on('error', () => {}); // Silence connection errors during probe

    await testClient.connect();
    const pong = await testClient.ping();
    const isOk = pong === 'PONG';
    redisAvailabilityCache = isOk;
    lastCheckTime = now;
    return isOk;
  } catch (err) {
    redisAvailabilityCache = false;
    lastCheckTime = now;
    return false;
  } finally {
    if (testClient) {
      try {
        testClient.disconnect();
      } catch (_) {}
    }
  }
};
