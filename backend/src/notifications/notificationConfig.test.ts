import { describe, expect, it } from 'vitest';
import { NotificationConfigSchema } from './notificationConfig.js';

describe('NotificationConfigSchema', () => {
  it('accepts valid addresses and removes case-insensitive duplicates', () => {
    expect(NotificationConfigSchema.parse({ emails: [' Ops@example.com ', 'ops@example.com', 'alerts@example.com'] }))
      .toEqual({ emails: ['Ops@example.com', 'alerts@example.com'] });
  });

  it('rejects invalid email addresses', () => {
    expect(NotificationConfigSchema.safeParse({ emails: ['not-an-email'] }).success).toBe(false);
  });
});
