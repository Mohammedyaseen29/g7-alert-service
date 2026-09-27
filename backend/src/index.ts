import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config/config.js';
import { logger } from './config/logger.js';
import { G7TcpServer } from './tcp/g7TcpServer.js';
import { parseG7Message } from './protocol/g7Parser.js';
import { discoverSensorDefinitions, normalizeMessage } from './sensors/sensorService.js';
import { SensorState } from './sensors/sensorState.js';
import { AlarmEngine } from './alarms/alarmEngine.js';
import { AlarmConfigSchema } from './alarms/alarmTypes.js';
import { BrevoEmailProvider } from './notifications/brevoEmailProvider.js';
import { AlarmNotificationService } from './notifications/alarmNotificationService.js';
import { PushService, pushSubscriptionSchema } from './notifications/pushService.js';
import { StationPushMonitor } from './notifications/stationPushMonitor.js';
import { NotificationConfigSchema } from './notifications/notificationConfig.js';
import { FileStore } from './database/fileStore.js';
import { PrismaStore } from './database/prismaStore.js';
import type { AppStore } from './database/store.js';
import { seedAdmin, signTokens, requireAuth, requireRole } from './auth/auth.js';
import { LiveBus } from './websocket/liveBus.js';
import { ReadingsStore } from './readings/readingsStore.js';
import { ObjectReadingJournal } from './readings/objectJournal.js';
import { ensureReadingsSchema } from './readings/schema.js';
import { OracleObjects } from './readings/oracleObjects.js';
import { SensorExports } from './readings/exports.js';
import { buildSensorReport } from './readings/reportPdf.js';
import { z } from 'zod';

const cfg = loadConfig();
const app = express();
const allowedOrigins = cfg.FRONTEND_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '256kb' }));

const hasConfiguredDatabase = cfg.DATABASE_URL.length > 0 && !cfg.DATABASE_URL.includes('[YOUR-PASSWORD]');
const prismaStore = hasConfiguredDatabase ? await PrismaStore.create() : null;
const store: AppStore = prismaStore ?? new FileStore(cfg.DATA_DIR);
if (!hasConfiguredDatabase) logger.warn('Using JSON persistence because DATABASE_URL has not been configured');
if (!prismaStore && cfg.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production for users, configuration, alarms, and export jobs');
const oracleObjects = new OracleObjects(cfg);
const objectReadings = new ObjectReadingJournal(oracleObjects);
const readings = prismaStore ? new ReadingsStore(prismaStore.prisma, objectReadings) : null;
if (readings) await ensureReadingsSchema(readings.prisma);
const sensorExports = readings ? new SensorExports(readings, oracleObjects, cfg.DATA_DIR) : null;
if (sensorExports) await sensorExports.start();
logger.info('New sensor readings and CSV exports are stored in Oracle Object Storage');
await seedAdmin(store, cfg.BCRYPT_ROUNDS);

const sensorState = new SensorState();
const engine = new AlarmEngine((id) => store.getAlarmConfig(id));
const notifier = new BrevoEmailProvider({
  enabled: cfg.EMAIL_ENABLED,
  host: cfg.BREVO_SMTP_HOST,
  port: cfg.BREVO_SMTP_PORT,
  user: cfg.BREVO_SMTP_USER,
  pass: cfg.BREVO_SMTP_PASSWORD,
  fromEmail: cfg.ALERT_FROM_EMAIL,
  fromName: cfg.ALERT_FROM_NAME,
}, () => store.getNotificationEmails());
const notifications = new AlarmNotificationService(engine, notifier, store, {
  repeatMinutes: cfg.ALARM_REPEAT_MINUTES,
  recoveryEnabled: cfg.RECOVERY_EMAIL_ENABLED,
  getBattery: (sensorId) => sensorState.snapshot()?.sensors[sensorId]?.battery,
});
const pushService = new PushService(prismaStore?.prisma ?? null, cfg);
await pushService.init();
const pushEvent = (kind: 'alarms' | 'station', title: string, body: string, url: '/alarms' | '/', tag: string) => {
  void pushService.send(kind, { title, body, url, tag }).catch((error) => logger.error({ error }, 'browser push event failed'));
};
const bus = new LiveBus();
const bootAt = new Date().toISOString();

// ---- TCP ingestion: Receiver -> Parse -> durable Oracle object -> State -> Alarm
let storageFailureAt: string | null = null;
async function processFrame(raw: string, remote: string, receivedAt: string, packetId?: string): Promise<void> {
    let msg;
    try {
      msg = parseG7Message(raw);
    } catch (err) {
      logger.warn({ err: String(err), remote }, 'parser error (raw preserved in log)');
      return;
    }
    for (const discovered of discoverSensorDefinitions(msg, store.getSensors())) store.upsertSensor(discovered);
    const normalized = normalizeMessage(msg, store.getSensors(), receivedAt);
    try {
      const saved = await objectReadings.captureMessage(msg, normalized, packetId ?? randomUUID());
      if (saved > 0) storageFailureAt = null;
    } catch (error) {
      storageFailureAt = new Date().toISOString();
      throw error;
    }
    const snapshot = sensorState.update(normalized);
    const { triggered, recovered } = engine.evaluate(snapshot, cfg.SENSOR_TIMEOUT_SECONDS);
    const timeouts = engine.checkTimeouts(snapshot, cfg.SENSOR_TIMEOUT_SECONDS);
    const allNew = [...triggered, ...timeouts.triggered];
    const allRec = [...recovered, ...timeouts.recovered];
    store.pushHistory([...allNew, ...allRec]);
    for (const alarm of allNew) pushEvent('alarms', `Alarm: Sensor ${alarm.sensorId}`, alarm.message, '/alarms', `alarm-${alarm.sensorId}-${alarm.kind}`);
    for (const alarm of allRec) pushEvent('alarms', `Recovered: Sensor ${alarm.sensorId}`, alarm.message, '/alarms', `recovered-${alarm.sensorId}-${alarm.kind}`);
    notifications.queueRecoveries(allRec);
    void notifications.flush();
    bus.broadcast({ type: 'sensors', at: new Date().toISOString(), snapshot, alarms: allNew });
    logger.debug({ station: msg.stationId, sensors: Object.keys(normalized.sensors) }, 'G7 message processed');
}
const stationMonitor = new StationPushMonitor(cfg.SENSOR_TIMEOUT_SECONDS * 1000, ({ title, body, tag }) => pushEvent('station', title, body, '/', tag));
const checkStationState = () => {
  const stats = tcp.stats();
  stationMonitor.update(stats.connectedBaseStations, stats.lastG7MessageAt);
};
const tcp = new G7TcpServer(cfg.G7_HOST, cfg.G7_PORT, { maxMessageBytes: cfg.G7_MAX_MESSAGE_BYTES, maxBufferBytes: cfg.G7_MAX_BUFFER_BYTES }, {
  onMessage: (raw, remote) => processFrame(raw, remote, new Date().toISOString()),
  onConnectionChange: () => checkStationState(),
  onTelemetry: () => checkStationState(),
});

// ---- Public health (no auth, for service monitors)
app.get('/health', (_req, res) => {
  const t = tcp.stats();
  res.json({ status: storageFailureAt ? 'degraded' : 'ok', tcpServer: t.listening ? 'listening' : 'stopped', connectedBaseStations: t.connectedBaseStations, lastG7Message: t.lastG7MessageAt, totalMessages: t.totalMessages, storageFailureAt, uptime: process.uptime(), bootAt });
});

// ---- Auth
const loginRate = rateLimit({ windowMs: 60_000, max: 20 });
app.post('/api/auth/login', loginRate, async (req, res) => {
  const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body);
  const user = store.getUsers().find((u) => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.hash))) {
    logger.warn({ username }, 'failed login');
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  logger.info({ username }, 'login');
  res.json({ ...signTokens(user, cfg.JWT_SECRET, cfg.JWT_REFRESH_SECRET, cfg.JWT_EXPIRES_IN), user: { id: user.id, username: user.username, role: user.role } });
});
app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }));

const auth = requireAuth(cfg.JWT_SECRET);

app.get('/api/push/config', auth, (_req, res) => res.json({ enabled: pushService.enabled, publicKey: pushService.publicKey }));
app.get('/api/push/status', auth, async (req, res) => {
  const endpoint = z.string().max(2048).safeParse(req.query.endpoint);
  if (!endpoint.success) { res.status(400).json({ error: 'Invalid subscription endpoint' }); return; }
  const user = (req as unknown as { user: { sub: string } }).user;
  try { res.json(await pushService.status(user.sub, endpoint.data)); }
  catch (error) { logger.error({ error }, 'push status failed'); res.status(500).json({ error: 'Could not check push status' }); }
});
app.post('/api/push/subscriptions', auth, async (req, res) => {
  if (!pushService.enabled) { res.status(503).json({ error: 'Push notifications are not configured' }); return; }
  const parsed = pushSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid browser push subscription' }); return; }
  const user = (req as unknown as { user: { sub: string } }).user;
  try { await pushService.subscribe(user.sub, parsed.data); res.status(201).json({ subscribed: true }); }
  catch (error) { logger.error({ error }, 'save push subscription failed'); res.status(500).json({ error: 'Could not save push subscription' }); }
});
app.delete('/api/push/subscriptions', auth, async (req, res) => {
  const endpoint = z.string().max(2048).safeParse(req.body?.endpoint);
  if (!endpoint.success) { res.status(400).json({ error: 'Invalid subscription endpoint' }); return; }
  const user = (req as unknown as { user: { sub: string } }).user;
  try { await pushService.unsubscribe(user.sub, endpoint.data); res.json({ subscribed: false }); }
  catch (error) { logger.error({ error }, 'remove push subscription failed'); res.status(500).json({ error: 'Could not remove push subscription' }); }
});
app.post('/api/push/test', auth, async (req, res) => {
  if (!pushService.enabled) { res.status(503).json({ error: 'Push notifications are not configured' }); return; }
  const user = (req as unknown as { user: { sub: string } }).user;
  try {
    const result = await pushService.send('alarms', { title: 'Tempmo test', body: 'Notifications are ready on this device.', url: '/', tag: 'push-test' }, user.sub);
    if (!result.attempted) { res.status(404).json({ error: 'No alarm push subscription is enabled for this account' }); return; }
    if (!result.accepted) { res.status(502).json({ error: 'Browser push service did not accept the test notification' }); return; }
    res.json({ sent: result.accepted });
  } catch (error) { logger.error({ error }, 'test push failed'); res.status(500).json({ error: 'Could not send test push' }); }
});

// ---- Sensors
app.get('/api/sensors', auth, (_req, res) => {
    const snap = sensorState.snapshot();
  const defs = store.getSensors();
  const now = Date.now();
  res.json(defs.map((d) => {
    const reading = snap?.sensors[d.id] ?? null;
    const online = Boolean(reading && now - Date.parse(reading.lastSeen) <= cfg.SENSOR_TIMEOUT_SECONDS * 1000);
    const activeAlarmCount = [...engine.active.values()].filter((alarm) => alarm.sensorId === d.id).length;
    return { ...d, active: d.active !== false, reading: d.active === false ? null : reading, online: d.active !== false && online, activeAlarmCount: d.active === false ? 0 : activeAlarmCount, thresholds: store.getAlarmConfig(d.id) };
  }));
});
app.get('/api/sensors/:id', auth, (req, res) => {
  const def = store.getSensors().find((s) => s.id === req.params.id);
  if (!def) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const snap = sensorState.snapshot();
  const reading = def.active === false ? null : snap?.sensors[def.id] ?? null;
  const online = def.active !== false && Boolean(reading && Date.now() - Date.parse(reading.lastSeen) <= cfg.SENSOR_TIMEOUT_SECONDS * 1000);
  res.json({ ...def, active: def.active !== false, reading, online, thresholds: store.getAlarmConfig(def.id), activeAlarms: def.active === false ? [] : [...engine.active.values()].filter((a) => a.sensorId === def.id) });
});
app.get('/api/sensors/:id/history', auth, (req, res) => {
  res.json(store.getHistory().filter((h) => h.sensorId === req.params.id).slice(0, 100));
});
app.get('/api/sensors/:id/alarms', auth, (req, res) => {
  res.json([...engine.active.values()].filter((a) => a.sensorId === req.params.id));
});
app.put('/api/sensors/:id/status', auth, requireRole('ADMIN', 'OPERATOR'), (req, res) => {
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  const sensor = store.getSensors().find((item) => item.id === req.params.id);
  if (!sensor) { res.status(404).json({ error: 'not found' }); return; }
  if (!parsed.success) { res.status(400).json({ error: 'active must be a boolean' }); return; }
  store.setSensorActive(sensor.id, parsed.data.active);
  if (!parsed.data.active) {
    sensorState.removeSensor(sensor.id);
    const recovered = engine.suspendSensor(sensor.id);
    if (recovered.length) {
      store.pushHistory(recovered);
    }
  }
  res.json({ sensorId: sensor.id, active: parsed.data.active, updatedAt: store.updatedAt });
});

// ---- Raw sensor history and server-side exports
app.get('/api/readings/report.pdf', auth, async (req, res) => {
  const parsed = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid report dates' }); return; }
  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.getTime() - 86_400_000);
  if (!(from < to) || to > new Date()) { res.status(400).json({ error: 'Choose a valid report period ending no later than now' }); return; }
  const activeSensors = store.getSensors().filter((sensor) => sensor.active !== false).map(({ id, name }) => ({ id, name }));
  if (!activeSensors.length) { res.status(400).json({ error: 'No active sensors are configured' }); return; }
  try {
    const pdf = await buildSensorReport(readings ?? objectReadings, activeSensors, from, to);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="tempmo-sensor-trends-${to.toISOString().slice(0, 10)}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(pdf);
  } catch (error) {
    logger.error({ error }, 'sensor graph report failed');
    res.status(500).json({ error: 'Could not prepare the sensor graph report' });
  }
});

function requestedSensorIds(value: unknown): string[] {
  if (value === undefined || value === '') return [];
  const ids = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const selected = [...new Set(ids.filter((id): id is string => typeof id === 'string').map((id) => id.trim()).filter(Boolean))];
  if (selected.length > 100 || selected.some((id) => !store.getSensors().some((sensor) => sensor.id === id))) throw new Error('Invalid sensor selection');
  return selected;
}
function exportDto(job: { id: string; sensorIds: unknown; from: Date; to: Date; status: string; rowCount: bigint | null; error: string | null; createdAt: Date; updatedAt: Date }) {
  return { id: job.id, sensorIds: job.sensorIds, from: job.from, to: job.to, status: job.status, rowCount: job.rowCount?.toString() ?? null, error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt };
}
app.get('/api/readings/availability', auth, async (req, res) => {
  if (!readings) { res.status(503).json({ error: 'Sensor history requires PostgreSQL' }); return; }
  try {
    const sensorIds = requestedSensorIds(req.query.sensorIds);
    const range = await readings.availability(sensorIds);
    res.json({ ...range, archiveConfigured: oracleObjects.enabled, hotDays: cfg.SENSOR_HOT_DAYS, exportTtlDays: cfg.SENSOR_EXPORT_TTL_DAYS });
  } catch (error) { res.status(400).json({ error: String(error) }); }
});
app.post('/api/readings/exports', auth, async (req, res) => {
  if (!sensorExports || !readings) { res.status(503).json({ error: 'Sensor exports require PostgreSQL' }); return; }
  const parsed = z.object({ sensorIds: z.array(z.string()).max(100).default([]), from: z.string().datetime().optional(), to: z.string().datetime().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid export filters' }); return; }
  try {
    const sensorIds = requestedSensorIds(parsed.data.sensorIds);
    const available = await readings.availability(sensorIds);
    if (!available.first) { res.status(400).json({ error: 'No saved readings are available for these sensors yet' }); return; }
    const requestedFrom = parsed.data.from ? new Date(parsed.data.from) : available.first;
    const from = requestedFrom < available.first ? available.first : requestedFrom;
    const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
    if (to > new Date()) { res.status(400).json({ error: 'End time cannot be in the future' }); return; }
    const user = (req as unknown as { user: { sub: string } }).user;
    const job = await sensorExports.create(user.sub, sensorIds, from, to);
    res.status(202).json(exportDto(job));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not create export' }); }
});
app.get('/api/readings/exports', auth, async (req, res) => {
  if (!sensorExports) { res.status(503).json({ error: 'Sensor history requires PostgreSQL' }); return; }
  const user = (req as unknown as { user: { sub: string } }).user;
  try { res.json((await sensorExports.list(user.sub)).map(exportDto)); }
  catch (error) { logger.error({ error }, 'list sensor exports failed'); res.status(500).json({ error: 'Could not list exports' }); }
});
app.get('/api/readings/exports/:id/download', auth, async (req, res) => {
  if (!sensorExports) { res.status(503).json({ error: 'Sensor history requires PostgreSQL' }); return; }
  if (!z.string().uuid().safeParse(req.params.id).success) { res.status(404).json({ error: 'Completed export not found' }); return; }
  const user = (req as unknown as { user: { sub: string } }).user;
  try {
    const url = await sensorExports.downloadUrl(req.params.id, user.sub);
    if (!url) { res.status(404).json({ error: 'Completed export not found' }); return; }
    res.json({ url });
  } catch (error) { logger.error({ error }, 'sign sensor export failed'); res.status(500).json({ error: 'Could not prepare download' }); }
});
app.get('/api/readings/exports/:id/file', auth, async (req, res) => {
  if (!sensorExports) { res.status(503).json({ error: 'Sensor history requires PostgreSQL' }); return; }
  if (!z.string().uuid().safeParse(req.params.id).success) { res.status(404).end(); return; }
  try {
    const user = (req as unknown as { user: { sub: string } }).user;
    const file = await sensorExports.openDownload(req.params.id, user.sub);
    if (!file) { res.status(404).end(); return; }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(file.source, createGunzip(), res);
  } catch (error) {
    if (res.destroyed) return;
    logger.error({ error }, 'download sensor export failed');
    if (res.headersSent) res.destroy();
    else res.status(500).json({ error: 'Could not download export' });
  }
});
app.get('/api/sensors/:id/config', auth, (req, res) => {
  const def = store.getSensors().find((s) => s.id === req.params.id);
  if (!def) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const secondaryRole = def.fields.humidity ? 'humidity' : def.fields.temperature2 ? 'temperature2' : 'unclassified';
  res.json({ sensorId: def.id, name: def.name, fields: def.fields, secondaryRole, updatedAt: store.updatedAt, ...store.getAlarmConfig(def.id) });
});
app.put('/api/sensors/:id/config', auth, requireRole('ADMIN', 'OPERATOR'), (req, res) => {
  const parsed = AlarmConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', issues: parsed.error.issues });
    return;
  }
  if (!store.getSensors().some((s) => s.id === req.params.id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  store.setAlarmConfig(req.params.id, parsed.data);
  logger.info({ sensor: req.params.id }, 'alarm config updated');
  res.json({ sensorId: req.params.id, updatedAt: store.updatedAt, ...parsed.data });
});
app.put('/api/sensors/:id/definition', auth, requireRole('ADMIN', 'OPERATOR'), (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(80),
    secondaryRole: z.enum(['unclassified', 'humidity', 'temperature2']),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', issues: parsed.error.issues });
    return;
  }
  const sensor = store.getSensors().find((item) => item.id === req.params.id);
  if (!sensor) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const secondaryField = sensor.fields.secondary ?? sensor.fields.humidity ?? sensor.fields.temperature2;
  const fields = { ...sensor.fields };
  delete fields.secondary;
  delete fields.humidity;
  delete fields.temperature2;
  if (secondaryField) {
    if (parsed.data.secondaryRole === 'humidity') fields.humidity = secondaryField;
    else if (parsed.data.secondaryRole === 'temperature2') fields.temperature2 = secondaryField;
    else fields.secondary = secondaryField;
  }
  const updated = { ...sensor, name: parsed.data.name, type: parsed.data.secondaryRole, fields };
  store.upsertSensor(updated);
  logger.info({ sensor: sensor.id, secondaryRole: parsed.data.secondaryRole }, 'sensor definition updated');
  res.json(updated);
});

// ---- Notification recipients (managed in the UI, never in environment variables)
app.get('/api/notifications/config', auth, (_req, res) => {
  res.json({ emails: store.getNotificationEmails(), updatedAt: store.updatedAt });
});
app.put('/api/notifications/config', auth, requireRole('ADMIN', 'OPERATOR'), (req, res) => {
  const parsed = NotificationConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', issues: parsed.error.issues });
    return;
  }
  store.setNotificationEmails(parsed.data.emails);
  logger.info({ recipientCount: parsed.data.emails.length }, 'notification recipients updated');
  res.json({ emails: parsed.data.emails, updatedAt: store.updatedAt });
});

// ---- Alarms / system
app.get('/api/alarms', auth, (_req, res) => {
  res.json({ active: [...engine.active.values()], history: engine.history.slice(0, 200) });
});
app.get('/api/alarms/export.csv', auth, async (req, res) => {
  const parsed = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), sensorId: z.string().max(80).optional() }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid alarm export filters' }); return; }
  const { from, to, sensorId } = parsed.data;
  if (from && to && from >= to) { res.status(400).json({ error: 'End time must be after start time' }); return; }
  const cell = (value: unknown) => {
    const plain = value === null || value === undefined ? '' : String(value);
    const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(plain) ? `'${plain}` : plain;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const line = (event: { stationId: string; sensorId: string; kind: string; lifecycle: string; value?: number | null; threshold?: number | null; startedAt: Date | string; recoveredAt?: Date | string | null; message: string }) => [
    event.stationId, event.sensorId, event.kind, event.lifecycle, event.value, event.threshold,
    new Date(event.startedAt).toISOString(), event.recoveredAt ? new Date(event.recoveredAt).toISOString() : '', event.message,
  ].map(cell).join(',') + '\n';
  try {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="alarm-history.csv"');
    res.write('station_id,sensor_id,event,lifecycle,value,threshold,started_at_utc,recovered_at_utc,message\n');
    if (prismaStore) {
      let cursor: string | undefined;
      for (;;) {
        const events = await prismaStore.prisma.alarmEvent.findMany({
          where: { ...(sensorId ? { sensorId } : {}), startedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(to) } : {}) } },
          orderBy: [{ startedAt: 'asc' }, { id: 'asc' }], take: 500,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (!events.length || res.destroyed) break;
        for (const event of events) {
          if (!res.write(line(event))) await once(res, 'drain');
        }
        cursor = events.at(-1)!.id;
      }
    } else {
      for (const event of store.getHistory().filter((item) => (!sensorId || item.sensorId === sensorId) && (!from || item.startedAt >= from) && (!to || item.startedAt < to))) {
        if (!res.write(line(event))) await once(res, 'drain');
      }
    }
    res.end();
  } catch (error) {
    logger.error({ error }, 'alarm CSV export failed');
    if (!res.headersSent) res.status(500).json({ error: 'Could not export alarm history' });
    else res.destroy(error as Error);
  }
});
app.get('/api/system/status', auth, (_req, res) => {
  const t = tcp.stats();
  const snap = sensorState.snapshot();
  const now = Date.now();
  const lastMessageAge = t.lastG7MessageAt ? now - Date.parse(t.lastG7MessageAt) : Number.POSITIVE_INFINITY;
  const baseStationState = t.connectedBaseStations === 0 ? 'DISCONNECTED' : lastMessageAge <= cfg.SENSOR_TIMEOUT_SECONDS * 1000 ? 'LIVE' : 'CONNECTED';
  const activeSensors = snap ? Object.values(snap.sensors).filter((reading) => now - Date.parse(reading.lastSeen) <= cfg.SENSOR_TIMEOUT_SECONDS * 1000).length : 0;
  res.json({
    g7: baseStationState, tcpListening: t.listening, connectedBaseStations: t.connectedBaseStations,
    lastMessage: t.lastG7MessageAt, lastSensorUpdate: snap?.lastMessageAt ?? null,
    activeSensors, activeAlarms: engine.active.size,
    email: notifier.status, notificationRecipients: store.getNotificationEmails().length, uptime: process.uptime(),
  });
});

const server = createServer(app);
bus.attach(server);
await tcp.listen();
server.listen(cfg.HTTP_PORT, cfg.HTTP_HOST, () => {
  logger.info({ http: `${cfg.HTTP_HOST}:${cfg.HTTP_PORT}`, g7: `${cfg.G7_HOST}:${cfg.G7_PORT}` }, 'Tempmo started');
});

const cleanupExports = () => { void sensorExports?.cleanupExpired(cfg.SENSOR_EXPORT_TTL_DAYS).catch((error) => logger.error({ error }, 'sensor export cleanup failed')); };
cleanupExports();
const exportCleanupTimer = setInterval(cleanupExports, 6 * 60 * 60_000);

const alarmTimer = setInterval(() => {
  checkStationState();
  const snap = sensorState.snapshot();
  if (snap) {
    const { triggered, recovered } = engine.checkTimeouts(snap, cfg.SENSOR_TIMEOUT_SECONDS);
    if (triggered.length || recovered.length) {
      store.pushHistory([...triggered, ...recovered]);
      bus.broadcast({ type: 'alarms', triggered, recovered });
      for (const alarm of triggered) pushEvent('alarms', `Alarm: Sensor ${alarm.sensorId}`, alarm.message, '/alarms', `alarm-${alarm.sensorId}-${alarm.kind}`);
      for (const alarm of recovered) pushEvent('alarms', `Recovered: Sensor ${alarm.sensorId}`, alarm.message, '/alarms', `recovered-${alarm.sensorId}-${alarm.kind}`);
    }
    notifications.queueRecoveries(recovered);
    void notifications.flush();
  }
}, 15_000);

process.on('SIGINT', async () => { clearInterval(alarmTimer); clearInterval(exportCleanupTimer); sensorExports?.stop(); await tcp.close(); await store.close(); process.exit(0); });
process.on('SIGTERM', async () => { clearInterval(alarmTimer); clearInterval(exportCleanupTimer); sensorExports?.stop(); await tcp.close(); await store.close(); process.exit(0); });
