import fs from 'node:fs';
import path from 'node:path';
import type { SensorDefinition } from '../sensors/sensorService.js';
import { DEFAULT_ALARM_CONFIG, type AlarmConfig } from '../alarms/alarmTypes.js';
import type { AlarmEvent } from '../alarms/alarmEngine.js';
import type { AppStore, NotificationLogEntry, StoredUser } from './store.js';

interface Persisted {
  sensors: SensorDefinition[];
  alarmConfigs: Record<string, AlarmConfig>;
  users: StoredUser[];
  alarmHistory: AlarmEvent[];
  notificationLog: NotificationLogEntry[];
  notificationEmails?: string[];
  updatedAt: string;
}

// JSON-file store (used when DATABASE_URL unset). Postgres/Prisma schema
// in prisma/schema.prisma is the production target with same entities.
export class FileStore implements AppStore {
  private file: string;
  private data: Persisted;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'g7-store.json');
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } else {
      this.data = { sensors: [], alarmConfigs: {}, users: [], alarmHistory: [], notificationLog: [], updatedAt: new Date().toISOString() };
      this.save();
    }
  }

  private save() {
    this.data.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  getSensors(): SensorDefinition[] {
    return this.data.sensors;
  }
  upsertSensor(def: SensorDefinition) {
    const i = this.data.sensors.findIndex((s) => s.id === def.id);
    if (i >= 0) this.data.sensors[i] = def;
    else {
      this.data.sensors.push(def);
      this.data.alarmConfigs[def.id] = structuredClone(DEFAULT_ALARM_CONFIG);
    }
    this.save();
  }
  getAlarmConfig(id: string): AlarmConfig {
    return this.data.alarmConfigs[id] ?? structuredClone(DEFAULT_ALARM_CONFIG);
  }
  setAlarmConfig(id: string, cfg: AlarmConfig) {
    this.data.alarmConfigs[id] = cfg;
    this.save();
  }
  getUsers() {
    return this.data.users;
  }
  addUser(u: StoredUser) {
    this.data.users.push(u);
    this.save();
  }
  pushHistory(ev: AlarmEvent[]) {
    this.data.alarmHistory.unshift(...ev);
    this.data.alarmHistory = this.data.alarmHistory.slice(0, 2000);
    this.save();
  }
  getHistory() {
    return this.data.alarmHistory;
  }
  logNotification(n: NotificationLogEntry) {
    this.data.notificationLog.unshift(n);
    this.data.notificationLog = this.data.notificationLog.slice(0, 2000);
    this.save();
  }
  getNotifications() {
    return this.data.notificationLog;
  }
  getNotificationEmails(): string[] {
    return this.data.notificationEmails ?? [];
  }
  setNotificationEmails(emails: string[]) {
    this.data.notificationEmails = emails;
    this.save();
  }
  get updatedAt() {
    return this.data.updatedAt;
  }
  async close(): Promise<void> {}
}
