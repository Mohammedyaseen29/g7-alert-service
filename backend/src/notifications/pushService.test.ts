import { expect, it } from 'vitest';
import { pushSubscriptionSchema } from './pushService.js';

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/example',
  keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
};

it('accepts browser push endpoints and rejects internal URLs', () => {
  expect(pushSubscriptionSchema.safeParse(subscription).success).toBe(true);
  expect(pushSubscriptionSchema.safeParse({ ...subscription, endpoint: 'http://127.0.0.1/secret' }).success).toBe(false);
  expect(pushSubscriptionSchema.safeParse({ ...subscription, endpoint: 'https://127.0.0.1/secret' }).success).toBe(false);
  expect(pushSubscriptionSchema.safeParse({ ...subscription, endpoint: 'https://fcm.googleapis.com.evil.test/' }).success).toBe(false);
});
