import rateLimit from 'express-rate-limit';

const disableRateLimitInDev =
  process.env.NODE_ENV !== 'production' && process.env.ENABLE_RATE_LIMIT_IN_DEV !== 'true';

export const loginRateLimit = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => disableRateLimitInDev,
});

export const apiRateLimit = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_API_WINDOW_MS) || 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
});

export const uploadRateLimit = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS) || 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_UPLOAD_MAX) || 10,
});

export const ragChatRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
});
