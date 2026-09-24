import { describe, expect, it, vi } from 'vitest';
import { AlarmEngine } from '../alarms/alarmEngine.js';
import { DEFAULT_ALARM_CONFIG } from '../alarms/alarmTypes.js';
import type { AppStore } from '../database/store.js';
import type { NotificationProvider } from './notificationProvider.js';
import { AlarmNotificationService } from './alarmNotificationService.js';

function snapshot(temperature: number, lastSeen: number) {
  return { stationId: '000000', lastMessageAt: new Date(lastSeen).toISOString(), rawMessage: '', sensors: {
    '02': { temperature, lastSeen: new Date(lastSeen).toISOString() },
  } } as never;
}

function setup() {
  let now = 1_000_000;
  const engine = new AlarmEngine(() => ({ ...structuredClone(DEFAULT_ALARM_CONFIG), delaySeconds: 0 }), { now: () => now });
  const sendAlarm = vi.fn<NotificationProvider['sendAlarm']>().mockResolvedValue(true);
  const sendRecovery = vi.fn<NotificationProvider['sendRecovery']>().mockResolvedValue(true);
  const provider: NotificationProvider = { status: 'enabled', sendAlarm, sendRecovery };
  const pushHistory = vi.fn();
  const logNotification = vi.fn();
  const store = { getSensors: () => [], pushHistory, logNotification } as unknown as Pick<AppStore, 'getSensors' | 'pushHistory' | 'logNotification'>;
  const service = new AlarmNotificationService(engine, provider, store, {
    repeatMinutes: 30, recoveryEnabled: true, getBattery: () => undefined, retryMs: 1_000, now: () => now,
  });
  return { engine, service, sendAlarm, sendRecovery, pushHistory, logNotification, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe('alarm email delivery', () => {
  it('retries a failed alarm and repeats only after the configured interval', async () => {
    const ctx = setup();
    ctx.engine.evaluate(snapshot(35, ctx.now()));
    ctx.sendAlarm.mockRejectedValueOnce(new Error('SMTP unavailable'));
    await ctx.service.flush();
    expect(ctx.logNotification).not.toHaveBeenCalled();
    expect([...ctx.engine.active.values()][0]?.lastNotifiedAt).toBeUndefined();

    ctx.advance(500);
    await ctx.service.flush();
    expect(ctx.sendAlarm).toHaveBeenCalledTimes(1);
    ctx.advance(500);
    await ctx.service.flush();
    expect(ctx.sendAlarm).toHaveBeenCalledTimes(2);
    expect(ctx.logNotification).toHaveBeenCalledTimes(1);
    expect([...ctx.engine.active.values()][0]?.lastNotifiedAt).toBeDefined();

    ctx.advance(29 * 60_000);
    await ctx.service.flush();
    expect(ctx.sendAlarm).toHaveBeenCalledTimes(2);
    ctx.advance(60_000);
    await ctx.service.flush();
    expect(ctx.sendAlarm).toHaveBeenCalledTimes(3);
    expect(ctx.logNotification).toHaveBeenCalledTimes(2);
  });

  it('sends and retries recovery after a delivered alarm', async () => {
    const ctx = setup();
    ctx.engine.evaluate(snapshot(35, ctx.now()));
    await ctx.service.flush();
    const recovered = ctx.engine.evaluate(snapshot(20, ctx.now())).recovered;
    ctx.service.queueRecoveries(recovered);
    ctx.sendRecovery.mockRejectedValueOnce(new Error('SMTP unavailable'));
    await ctx.service.flush();
    expect(ctx.logNotification).toHaveBeenCalledTimes(1);
    ctx.advance(1_000);
    await ctx.service.flush();
    expect(ctx.sendRecovery).toHaveBeenCalledTimes(2);
    expect(ctx.logNotification).toHaveBeenCalledTimes(2);
  });

  it('delivers alarms triggered by the periodic disconnection check', async () => {
    const ctx = setup();
    ctx.engine.checkTimeouts(snapshot(25, ctx.now() - 200_000), 120);
    await ctx.service.flush();
    expect(ctx.sendAlarm).toHaveBeenCalledTimes(1);
    expect(ctx.logNotification).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sensor_disconnected', type: 'alarm' }));
  });

  it('does not record a notification when delivery is skipped', async () => {
    const ctx = setup();
    ctx.engine.evaluate(snapshot(35, ctx.now()));
    ctx.sendAlarm.mockResolvedValue(false);
    await ctx.service.flush();
    expect(ctx.logNotification).not.toHaveBeenCalled();
  });
});
