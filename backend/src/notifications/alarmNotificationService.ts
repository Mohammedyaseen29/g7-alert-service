import type { AlarmEngine, AlarmEvent } from '../alarms/alarmEngine.js';
import type { AppStore } from '../database/store.js';
import { logger } from '../config/logger.js';
import type { NotificationProvider } from './notificationProvider.js';

const DEFAULT_RETRY_MS = 60_000;

export class AlarmNotificationService {
  private readonly lastAttempt = new Map<string, number>();
  private readonly pendingRecoveries = new Map<string, AlarmEvent>();
  private readonly deliveredAlarmIds = new Set<string>();
  private flushing = false;
  private rerun = false;

  constructor(
    private readonly engine: AlarmEngine,
    private readonly provider: NotificationProvider,
    private readonly store: Pick<AppStore, 'getSensors' | 'pushHistory' | 'logNotification'>,
    private readonly options: {
      repeatMinutes: number;
      recoveryEnabled: boolean;
      getBattery: (sensorId: string) => number | undefined;
      retryMs?: number;
      now?: () => number;
    },
  ) {}

  queueRecoveries(events: AlarmEvent[]): void {
    for (const event of events) {
      this.lastAttempt.delete(`alarm:${event.id}`);
      if (this.options.recoveryEnabled) this.pendingRecoveries.set(event.id, event);
      else this.deliveredAlarmIds.delete(event.id);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      this.rerun = true;
      return;
    }
    this.flushing = true;
    try {
      do {
        this.rerun = false;
        await this.flushOnce();
      } while (this.rerun);
    } finally {
      this.flushing = false;
    }
  }

  private due(key: string): boolean {
    const now = (this.options.now ?? Date.now)();
    const last = this.lastAttempt.get(key);
    if (last !== undefined && now - last < (this.options.retryMs ?? DEFAULT_RETRY_MS)) return false;
    this.lastAttempt.set(key, now);
    return true;
  }

  private sensorName(id: string): string | undefined {
    return this.store.getSensors().find((sensor) => sensor.id === id)?.name;
  }

  private async flushOnce(): Promise<void> {
    for (const event of [...this.engine.active.values()]) {
      const now = (this.options.now ?? Date.now)();
      if (!this.engine.shouldNotify(event, this.options.repeatMinutes, now) || !this.due(`alarm:${event.id}`)) continue;
      try {
        const accepted = await this.provider.sendAlarm(event, {
          sensorName: this.sensorName(event.sensorId),
          battery: this.options.getBattery(event.sensorId),
        });
        if (!accepted) continue;
        const sentAt = new Date((this.options.now ?? Date.now)()).toISOString();
        this.deliveredAlarmIds.add(event.id);
        const stillActive = [...this.engine.active.values()].some((active) => active.id === event.id);
        if (stillActive) {
          this.engine.markNotified(event.id, sentAt);
          this.store.pushHistory([event]);
        }
        this.store.logNotification({ at: sentAt, type: 'alarm', sensorId: event.sensorId, kind: event.kind });
        this.lastAttempt.delete(`alarm:${event.id}`);
      } catch (error) {
        logger.error({ error, sensorId: event.sensorId, kind: event.kind }, 'alarm email failed; will retry');
      }
    }

    for (const [id, event] of this.pendingRecoveries) {
      if (!event.lastNotifiedAt && !this.deliveredAlarmIds.has(id)) {
        this.pendingRecoveries.delete(id);
        continue;
      }
      if (!this.due(`recovery:${id}`)) continue;
      try {
        const accepted = await this.provider.sendRecovery(event, { sensorName: this.sensorName(event.sensorId) });
        if (!accepted) continue;
        const sentAt = new Date((this.options.now ?? Date.now)()).toISOString();
        this.store.logNotification({ at: sentAt, type: 'recovery', sensorId: event.sensorId, kind: event.kind });
        this.pendingRecoveries.delete(id);
        this.deliveredAlarmIds.delete(id);
        this.lastAttempt.delete(`recovery:${id}`);
      } catch (error) {
        logger.error({ error, sensorId: event.sensorId, kind: event.kind }, 'recovery email failed; will retry');
      }
    }
  }
}
