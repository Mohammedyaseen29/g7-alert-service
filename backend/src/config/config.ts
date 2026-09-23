import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  G7_HOST: z.string().default('0.0.0.0'),
  G7_PORT: z.coerce.number().int().min(1).max(65535).default(6900),
  G7_MAX_MESSAGE_BYTES: z.coerce.number().default(65536),
  G7_MAX_BUFFER_BYTES: z.coerce.number().default(1048576),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().default(3000),
  // Comma-separated browser origins allowed to call the HTTP API.
  FRONTEND_ORIGIN: z.string().default('https://monitoring.prideengs.com'),
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
  ALERT_FROM_NAME: z.string().default('Pride Monitoring'),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('1d'),
  BCRYPT_ROUNDS: z.coerce.number().default(10),
  DATABASE_URL: z.string().default(''),
  DATA_DIR: z.string().default('./data'),
  OCI_OBJECT_NAMESPACE: z.string().default(''),
  OCI_OBJECT_REGION: z.string().default(''),
  OCI_OBJECT_BUCKET: z.string().default(''),
  OCI_OBJECT_ACCESS_KEY: z.string().default(''),
  OCI_OBJECT_SECRET_KEY: z.string().default(''),
  SENSOR_HOT_DAYS: z.coerce.number().int().min(3).max(3650).default(90),
  SENSOR_SPOOL_MAX_MB: z.coerce.number().int().min(16).max(16384).default(512),
  SENSOR_EXPORT_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(7),
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
