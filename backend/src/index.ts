import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { createServer } from 'node:http';
import { loadConfig } from './config/config.js';
import { logger } from './config/logger.js';
import { G7TcpServer } from './tcp/g7TcpServer.js';
import { parseG7Message } from './protocol/g7Parser.js';
import { discoverSensorDefinitions, normalizeMessage } from './sensors/sensorService.js';
import { SensorState } from './sensors/sensorState.js';
import { AlarmEngine } from './alarms/alarmEngine.js';
import { AlarmConfigSchema } from './alarms/alarmTypes.js';
import { BrevoEmailProvider } from './notifications/brevoEmailProvider.js';
import { NotificationConfigSchema } from './notifications/notificationConfig.js';
import { FileStore } from './database/fileStore.js';
import { PrismaStore } from './database/prismaStore.js';
import type { AppStore } from './database/store.js';
import { seedAdmin, signTokens, requireAuth, requireRole } from './auth/auth.js';
import { LiveBus } from './websocket/liveBus.js';
import { z } from 'zod';

const cfg = loadConfig();
const app = express();
app.use(cors({ origin: cfg.FRONTEND_ORIGIN }));
app.use(express.json({ limit: '256kb' }));

const hasConfiguredDatabase = cfg.DATABASE_URL.length > 0 && !cfg.DATABASE_URL.includes('[YOUR-PASSWORD]');
const store: AppStore = hasConfiguredDatabase
  ? await PrismaStore.create()
  : new FileStore(cfg.DATA_DIR);
if (!hasConfiguredDatabase) logger.warn('Using JSON persistence because DATABASE_URL has not been configured');
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
const bus = new LiveBus();
const bootAt = new Date().toISOString();

// ---- TCP ingestion: Receiver -> Framer -> Parser -> Normalize -> State -> Alarm -> Notify
const tcp = new G7TcpServer(cfg.G7_HOST, cfg.G7_PORT, { maxMessageBytes: cfg.G7_MAX_MESSAGE_BYTES, maxBufferBytes: cfg.G7_MAX_BUFFER_BYTES }, {
  onMessage: (raw, remote) => {
    let msg;
    try {
      msg = parseG7Message(raw);
    } catch (err) {
      logger.warn({ err: String(err), remote }, 'parser error (raw preserved in log)');
      return;
    }
    for (const discovered of discoverSensorDefinitions(msg, store.getSensors())) store.upsertSensor(discovered);
    const normalized = normalizeMessage(msg, store.getSensors());
    const snapshot = sensorState.update(normalized);
    const { triggered, recovered } = engine.evaluate(snapshot);
    const timeouts = engine.checkTimeouts(snapshot, cfg.SENSOR_TIMEOUT_SECONDS);
    const allNew = [...triggered, ...timeouts.triggered];
    const allRec = [...recovered, ...timeouts.recovered];
    store.pushHistory([...allNew, ...allRec]);
    (async () => {
      for (const ev of allNew) {
        const sensorDef = store.getSensors().find((s) => s.id === ev.sensorId);
        const reading = snapshot.sensors[ev.sensorId];
        await notifier.sendAlarm(ev, { sensorName: sensorDef?.name, battery: reading?.battery });
        engine.markNotified(ev.id);
        store.logNotification({ at: new Date().toISOString(), type: 'alarm', sensorId: ev.sensorId, kind: ev.kind });
      }
      if (cfg.RECOVERY_EMAIL_ENABLED) {
        for (const ev of allRec) {
          const sensorDef = store.getSensors().find((s) => s.id === ev.sensorId);
          await notifier.sendRecovery(ev, { sensorName: sensorDef?.name });
          store.logNotification({ at: new Date().toISOString(), type: 'recovery', sensorId: ev.sensorId, kind: ev.kind });
        }
      }
    })().catch((e) => logger.error({ e }, 'notify error'));
    bus.broadcast({ type: 'sensors', at: new Date().toISOString(), snapshot, alarms: allNew });
    logger.info({ station: msg.stationId, sensors: Object.keys(normalized.sensors) }, 'G7 message processed');
  },
});

// ---- Public health (no auth, for service monitors)
app.get('/health', (_req, res) => {
  const t = tcp.stats();
  res.json({ status: 'ok', tcpServer: t.listening ? 'listening' : 'stopped', connectedBaseStations: t.connectedBaseStations, lastG7Message: t.lastG7MessageAt, totalMessages: t.totalMessages, uptime: process.uptime(), bootAt });
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

// ---- Sensors
app.get('/api/sensors', auth, (_req, res) => {
  const snap = sensorState.snapshot();
  const defs = store.getSensors();
  const now = Date.now();
  res.json(defs.map((d) => {
    const reading = snap?.sensors[d.id] ?? null;
    const online = Boolean(reading && now - Date.parse(reading.lastSeen) <= cfg.SENSOR_TIMEOUT_SECONDS * 1000);
    const activeAlarmCount = [...engine.active.values()].filter((alarm) => alarm.sensorId === d.id).length;
    return { ...d, reading, online, activeAlarmCount, thresholds: store.getAlarmConfig(d.id) };
  }));
});
app.get('/api/sensors/:id', auth, (req, res) => {
  const def = store.getSensors().find((s) => s.id === req.params.id);
  if (!def) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const snap = sensorState.snapshot();
  const reading = snap?.sensors[def.id] ?? null;
  const online = Boolean(reading && Date.now() - Date.parse(reading.lastSeen) <= cfg.SENSOR_TIMEOUT_SECONDS * 1000);
  res.json({ ...def, reading, online, thresholds: store.getAlarmConfig(def.id), activeAlarms: [...engine.active.values()].filter((a) => a.sensorId === def.id) });
});
app.get('/api/sensors/:id/history', auth, (req, res) => {
  res.json(store.getHistory().filter((h) => h.sensorId === req.params.id).slice(0, 100));
});
app.get('/api/sensors/:id/alarms', auth, (req, res) => {
  res.json([...engine.active.values()].filter((a) => a.sensorId === req.params.id));
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
  logger.info({ http: `${cfg.HTTP_HOST}:${cfg.HTTP_PORT}`, g7: `${cfg.G7_HOST}:${cfg.G7_PORT}` }, 'G7 Alert Service started');
});

setInterval(() => {
  const snap = sensorState.snapshot();
  if (snap) {
    const { triggered, recovered } = engine.checkTimeouts(snap, cfg.SENSOR_TIMEOUT_SECONDS);
    if (triggered.length || recovered.length) {
      store.pushHistory([...triggered, ...recovered]);
      bus.broadcast({ type: 'alarms', triggered, recovered });
    }
  }
}, 15_000);

process.on('SIGINT', async () => { await tcp.close(); await store.close(); process.exit(0); });
process.on('SIGTERM', async () => { await tcp.close(); await store.close(); process.exit(0); });
