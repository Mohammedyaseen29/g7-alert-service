import type { AlarmEvent } from '../alarms/alarmEngine.js';

export interface NotificationProvider {
  sendAlarm(alert: AlarmEvent, context: { sensorName?: string; battery?: number }): Promise<void>;
  sendRecovery(alert: AlarmEvent, context: { sensorName?: string }): Promise<void>;
  readonly status: string;
}
