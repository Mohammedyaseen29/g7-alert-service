import type { AlarmConfig } from '../alarms/alarmTypes.js';
import type { AlarmEvent } from '../alarms/alarmEngine.js';
import type { SensorDefinition } from '../sensors/sensorService.js';

export interface StoredUser {
  id: string;
  username: string;
  hash: string;
  role: string;
}

export interface NotificationLogEntry {
  at: string;
  type: string;
  sensorId: string;
  kind: string;
}

export interface AppStore {
  getSensors(): SensorDefinition[];
  upsertSensor(def: SensorDefinition): void;
  setSensorActive(id: string, active: boolean): void;
  getAlarmConfig(id: string): AlarmConfig;
  setAlarmConfig(id: string, cfg: AlarmConfig): void;
  getUsers(): StoredUser[];
  addUser(user: StoredUser): void;
  pushHistory(events: AlarmEvent[]): void;
  getHistory(): AlarmEvent[];
  logNotification(entry: NotificationLogEntry): void;
  getNotifications(): NotificationLogEntry[];
  getNotificationEmails(): string[];
  setNotificationEmails(emails: string[]): void;
  readonly updatedAt: string;
  close(): Promise<void>;
}
