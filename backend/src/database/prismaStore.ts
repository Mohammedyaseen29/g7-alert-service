import { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_ALARM_CONFIG, type AlarmConfig } from '../alarms/alarmTypes.js';
import type { AlarmEvent } from '../alarms/alarmEngine.js';
import { logger } from '../config/logger.js';
import type { SensorDefinition, SensorFieldMap } from '../sensors/sensorService.js';
import type { AppStore, NotificationLogEntry, StoredUser } from './store.js';

interface Cache {
  sensors: SensorDefinition[];
  alarmConfigs: Record<string, AlarmConfig>;
  users: StoredUser[];
  alarmHistory: AlarmEvent[];
  notificationLog: NotificationLogEntry[];
  notificationEmails: string[];
  updatedAt: string;
}

const STATION_ID = '000000';

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function cloneDefaultAlarmConfig(): AlarmConfig {
  return structuredClone(DEFAULT_ALARM_CONFIG);
}

export class PrismaStore implements AppStore {
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(readonly prisma: PrismaClient, private cache: Cache) {}

  static async create(): Promise<PrismaStore> {
    // The transaction pooler is ideal for short application queries, but this
    // Windows host cannot reach its IPv6-only endpoint. Prefer the configured
    // session-pooler connection when it is available so persistence remains
    // reliable on both local development and deployed hosts.
    const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
    const prisma = new PrismaClient({ datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined });
    await prisma.$connect();
    await prisma.station.upsert({ where: { id: STATION_ID }, update: {}, create: { id: STATION_ID } });
    const [sensors, users, alarmHistory, notificationLog, settings] = await Promise.all([
      prisma.sensor.findMany({ include: { alarm: true }, orderBy: { id: 'asc' } }),
      prisma.user.findMany({ orderBy: { username: 'asc' } }),
      prisma.alarmEvent.findMany({ orderBy: { startedAt: 'desc' }, take: 2000 }),
      prisma.notificationLog.findMany({ orderBy: { at: 'desc' }, take: 2000 }),
      prisma.appSettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default', notificationEmails: [] } }),
    ]);

    const cache: Cache = {
      sensors: sensors.map((sensor) => ({ id: sensor.id, name: sensor.name, type: sensor.type, fields: sensor.fieldMap as unknown as SensorFieldMap })),
      alarmConfigs: Object.fromEntries(sensors.map((sensor) => [sensor.id, sensor.alarm ? sensor.alarm.thresholds as unknown as AlarmConfig : cloneDefaultAlarmConfig()])),
      users: users.map((user) => ({ id: user.id, username: user.username, hash: user.hash, role: user.role })),
      alarmHistory: alarmHistory.map((event) => ({
        id: event.id, stationId: event.stationId, sensorId: event.sensorId, kind: event.kind as AlarmEvent['kind'], lifecycle: event.lifecycle as AlarmEvent['lifecycle'],
        value: event.value ?? undefined, threshold: event.threshold ?? undefined, startedAt: event.startedAt.toISOString(), recoveredAt: event.recoveredAt?.toISOString(), lastNotifiedAt: event.lastNotifiedAt?.toISOString(), message: event.message,
      })),
      notificationLog: notificationLog.map((entry) => ({ at: entry.at.toISOString(), type: entry.type, sensorId: entry.sensorId, kind: entry.kind })),
      notificationEmails: settings.notificationEmails as unknown as string[],
      updatedAt: settings.updatedAt.toISOString(),
    };
    logger.info({ sensors: cache.sensors.length, users: cache.users.length }, 'PostgreSQL store connected');
    return new PrismaStore(prisma, cache);
  }

  private touch() {
    this.cache.updatedAt = new Date().toISOString();
  }

  private enqueue(operation: () => Promise<void>) {
    this.writeQueue = this.writeQueue.then(operation).catch((error) => {
      logger.error({ error }, 'PostgreSQL persistence error');
    });
  }

  getSensors() { return this.cache.sensors; }

  upsertSensor(def: SensorDefinition) {
    const index = this.cache.sensors.findIndex((sensor) => sensor.id === def.id);
    if (index >= 0) this.cache.sensors[index] = def;
    else {
      this.cache.sensors.push(def);
      this.cache.sensors.sort((a, b) => a.id.localeCompare(b.id));
      this.cache.alarmConfigs[def.id] = cloneDefaultAlarmConfig();
    }
    this.touch();
    this.enqueue(async () => {
      await this.prisma.sensor.upsert({
        where: { id: def.id },
        update: { name: def.name, type: def.type, fieldMap: asJson(def.fields) },
        create: { id: def.id, stationId: STATION_ID, name: def.name, type: def.type, fieldMap: asJson(def.fields) },
      });
    });
  }

  getAlarmConfig(id: string) { return this.cache.alarmConfigs[id] ?? cloneDefaultAlarmConfig(); }

  setAlarmConfig(id: string, cfg: AlarmConfig) {
    this.cache.alarmConfigs[id] = cfg;
    this.touch();
    this.enqueue(async () => {
      await this.prisma.alarmConfiguration.upsert({
        where: { sensorId: id },
        update: { thresholds: asJson(cfg) },
        create: { sensorId: id, thresholds: asJson(cfg) },
      });
    });
  }

  getUsers() { return this.cache.users; }

  addUser(user: StoredUser) {
    const index = this.cache.users.findIndex((item) => item.id === user.id);
    if (index >= 0) this.cache.users[index] = user;
    else this.cache.users.push(user);
    this.touch();
    this.enqueue(async () => {
      await this.prisma.user.upsert({ where: { id: user.id }, update: { username: user.username, hash: user.hash, role: user.role }, create: user });
    });
  }

  pushHistory(events: AlarmEvent[]) {
    if (events.length === 0) return;
    for (const event of events) {
      const index = this.cache.alarmHistory.findIndex((item) => item.id === event.id);
      if (index >= 0) this.cache.alarmHistory[index] = event;
      else this.cache.alarmHistory.unshift(event);
    }
    this.cache.alarmHistory = this.cache.alarmHistory.slice(0, 2000);
    this.touch();
    this.enqueue(async () => {
      for (const event of events) {
        await this.prisma.alarmEvent.upsert({
          where: { id: event.id },
          update: { lifecycle: event.lifecycle, value: event.value, threshold: event.threshold, recoveredAt: event.recoveredAt ? new Date(event.recoveredAt) : null, lastNotifiedAt: event.lastNotifiedAt ? new Date(event.lastNotifiedAt) : null, message: event.message },
          create: { id: event.id, stationId: event.stationId, sensorId: event.sensorId, kind: event.kind, lifecycle: event.lifecycle, value: event.value, threshold: event.threshold, startedAt: new Date(event.startedAt), recoveredAt: event.recoveredAt ? new Date(event.recoveredAt) : null, lastNotifiedAt: event.lastNotifiedAt ? new Date(event.lastNotifiedAt) : null, message: event.message },
        });
      }
    });
  }

  getHistory() { return this.cache.alarmHistory; }

  logNotification(entry: NotificationLogEntry) {
    this.cache.notificationLog.unshift(entry);
    this.cache.notificationLog = this.cache.notificationLog.slice(0, 2000);
    this.touch();
    this.enqueue(async () => {
      await this.prisma.notificationLog.create({ data: { at: new Date(entry.at), type: entry.type, sensorId: entry.sensorId, kind: entry.kind } });
    });
  }

  getNotifications() { return this.cache.notificationLog; }
  getNotificationEmails() { return this.cache.notificationEmails; }

  setNotificationEmails(emails: string[]) {
    this.cache.notificationEmails = emails;
    this.touch();
    this.enqueue(async () => {
      await this.prisma.appSettings.upsert({ where: { id: 'default' }, update: { notificationEmails: asJson(emails) }, create: { id: 'default', notificationEmails: asJson(emails) } });
    });
  }

  get updatedAt() { return this.cache.updatedAt; }

  async close() {
    await this.writeQueue;
    await this.prisma.$disconnect();
  }
}
