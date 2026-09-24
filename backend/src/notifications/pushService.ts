import type { PrismaClient, PushSubscription } from '@prisma/client';
import webPush from 'web-push';
import { z } from 'zod';
import type { AppConfig } from '../config/config.js';
import { logger } from '../config/logger.js';

const endpointSchema = z.string().url().max(2048).refine((value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
    || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
}, 'Unsupported browser push endpoint');

export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,120}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/),
  }),
  alarms: z.boolean().default(true),
  station: z.boolean().default(true),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
export type PushMessage = { title: string; body: string; url: '/alarms' | '/'; tag: string };

export class PushService {
  readonly enabled: boolean;
  readonly publicKey: string;

  constructor(private prisma: PrismaClient | null, config: AppConfig) {
    const hasPublic = Boolean(config.WEB_PUSH_PUBLIC_KEY);
    const hasPrivate = Boolean(config.WEB_PUSH_PRIVATE_KEY);
    if (hasPublic !== hasPrivate) throw new Error('Both WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY are required');
    this.enabled = Boolean(prisma && hasPublic && hasPrivate);
    this.publicKey = this.enabled ? config.WEB_PUSH_PUBLIC_KEY : '';
    if (this.enabled) webPush.setVapidDetails(config.WEB_PUSH_SUBJECT, config.WEB_PUSH_PUBLIC_KEY, config.WEB_PUSH_PRIVATE_KEY);
  }

  async init(): Promise<void> {
    if (!this.enabled || !this.prisma) return;
    await this.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      alarms BOOLEAN NOT NULL DEFAULT true,
      station BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await this.prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions ("userId")');
  }

  async subscribe(userId: string, input: PushSubscriptionInput): Promise<void> {
    if (!this.prisma || !this.enabled) throw new Error('Push notifications are not configured');
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, userId, p256dh: input.keys.p256dh, auth: input.keys.auth, alarms: input.alarms, station: input.station },
      update: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, alarms: input.alarms, station: input.station },
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    if (!this.prisma) return;
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  async status(userId: string, endpoint: string): Promise<{ subscribed: boolean; alarms: boolean; station: boolean }> {
    if (!this.prisma || !this.enabled) return { subscribed: false, alarms: false, station: false };
    const row = await this.prisma.pushSubscription.findFirst({ where: { userId, endpoint } });
    return { subscribed: Boolean(row), alarms: row?.alarms ?? false, station: row?.station ?? false };
  }

  async send(kind: 'alarms' | 'station', message: PushMessage, userId?: string): Promise<{ attempted: number; accepted: number }> {
    if (!this.prisma || !this.enabled) return { attempted: 0, accepted: 0 };
    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { [kind]: true, ...(userId ? { userId } : {}) } });
    let accepted = 0;
    for (const row of subscriptions) if (await this.deliver(row, message)) accepted += 1;
    return { attempted: subscriptions.length, accepted };
  }

  private async deliver(row: PushSubscription, message: PushMessage): Promise<boolean> {
    try {
      await webPush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(message), { TTL: 300 });
      return true;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await this.prisma?.pushSubscription.deleteMany({ where: { endpoint: row.endpoint } });
      else logger.error({ error, status }, 'browser push delivery failed');
      return false;
    }
  }
}
