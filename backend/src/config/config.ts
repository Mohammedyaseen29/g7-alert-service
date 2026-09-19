import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  G7_HOST: z.string().default('0.0.0.0'),
  G7_PORT: z.coerce.number().int().min(1).max(65535).default(6900),
  G7_MAX_MESSAGE_BYTES: z.coerce.number().default(65536),
  G7_MAX_BUFFER_BYTES: z.coerce.number().default(1048576),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().default(3000),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  ALARM_DELAY_SECONDS: z.coerce.number().default(300),
  ALARM_REPEAT_MINUTES: z.coerce.number().default(30),
  SENSOR_TIMEOUT_SECONDS: z.coerce.number().default(120),
  RECOVERY_EMAIL_ENABLED: z.coerce.boolean().default(true),
  EMAIL_ENABLED: z.coerce.boolean().default(false),
  BREVO_SMTP_HOST: z.string().default('smtp-relay.brevo.com'),
  BREVO_SMTP_PORT: z.coerce.number().default(587),
  BREVO_SMTP_USER: z.string().default(''),
  BREVO_SMTP_PASSWORD: z.string().default(''),
  ALERT_FROM_EMAIL: z.string().default(''),
  ALERT_FROM_NAME: z.string().default('Pride Monitor'),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('15m'),
  BCRYPT_ROUNDS: z.coerce.number().default(10),
  DATABASE_URL: z.string().default(''),
  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.string().default('development'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  return parsed.data;
}
