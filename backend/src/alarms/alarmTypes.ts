import { z } from 'zod';

export const AlarmConfigSchema = z.object({
  temperature: z.object({ high: z.number(), low: z.number(), enabled: z.boolean().default(true) }).partial().default({}),
  humidity: z.object({ high: z.number(), low: z.number(), enabled: z.boolean().default(true) }).partial().default({}),
  battery: z.object({ low: z.number(), enabled: z.boolean().default(true) }).partial().default({}),
  comm: z.object({ enabled: z.boolean().default(true) }).default({}),
  delaySeconds: z.number().min(0).max(3600).default(300),
  repeatMinutes: z.number().min(0).max(1440).default(30),
}).superRefine((v, ctx) => {
  if (v.temperature?.high !== undefined && v.temperature?.low !== undefined && v.temperature.high <= v.temperature.low) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'temperature.high must be > low', path: ['temperature', 'high'] });
  }
  if (v.humidity?.high !== undefined && v.humidity?.low !== undefined && v.humidity.high <= v.humidity.low) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'humidity.high must be > low', path: ['humidity', 'high'] });
  }
});

export type AlarmConfig = z.infer<typeof AlarmConfigSchema>;

export const DEFAULT_ALARM_CONFIG: AlarmConfig = {
  temperature: { high: 30, low: 10, enabled: true },
  humidity: { high: 80, low: 20, enabled: true },
  battery: { low: 3.3, enabled: true },
  comm: { enabled: true },
  delaySeconds: 300,
  repeatMinutes: 30,
};
