import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Never log secrets: callers must not pass passwords/tokens here.
});
