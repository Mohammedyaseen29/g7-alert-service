import type { AlarmEvent } from '../alarms/alarmEngine.js';

export interface NotificationProvider {
  // true only when the SMTP server accepted the message for every recipient.
  sendAlarm(alert: AlarmEvent, context: { sensorName?: string; battery?: number }): Promise<boolean>;
  sendRecovery(alert: AlarmEvent, context: { sensorName?: string }): Promise<boolean>;
  readonly status: string;
}
