# Tempmo

Independent monitoring and alerting for G7 wireless sensors. It continues to
receive data and evaluate alarms when the original G7 Client interface is closed.

## Tempmo dashboard

The React dashboard uses Tailwind CSS, shadcn-style Radix UI components,
Lucide icons, and Recharts. It includes responsive sensor cards, status filters,
an inspection drawer, alarm activity, notification settings, and browser sound controls.

- Counts and readings come from the live API; there are no seeded demo sensor cards.
- Critical indicates an active alarm; Warning indicates an offline sensor or an enabled threshold breach.
- The dashboard heading can be changed to a client name. It is saved in that browser on that device.
- Sparklines and the inspection drawer's quick CSV use up to 60 distinct readings observed in the current dashboard session. The **History** page exports saved readings as CSV and draws every active sensor on one A4 landscape PDF page.
- The temperature gauge uses configured low/high limits. Without valid enabled limits, it shows an unavailable scale rather than inventing one.
- The API currently supplies sensor IDs, not hardware EUI identifiers.
- Existing authentication roles still govern configuration actions. Browser sound needs a user interaction to enable playback.

Frontend validation: run `npm test` and `npm run build` from `frontend`.

```
Sensors →(RF)→ Base Station →(TCP)→ Node backend → Parser → State → Alarms → Email
React PWA → REST/WS → Node backend → State / Config / DB
Browser subscription → PostgreSQL → Web Push → PWA service worker → device notification
G7 frames → Oracle Object Storage reading objects → live state and alarms
History filters → Oracle CSV.gz job → authenticated download
Active sensor history → one-page A4 PDF trend report
```

> **Direct-Mode constraint:** the Base Station sends to **one** TCP client. Close the G7 Client before starting Node on `6900`
> (one listener per port). Production = `Base → Node → React`; original Client retired for monitoring.

## Requirements

- Node.js 22 or later
- A PostgreSQL database (Supabase PostgreSQL is supported)
- Optional: a configured email sender for alarm delivery

## PWA push notifications

Set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` in the backend environment. Generate a VAPID key pair once with `npx web-push generate-vapid-keys`. Keep the same key pair across restarts and deployments, because replacing it invalidates existing browser subscriptions. Push subscriptions are stored in PostgreSQL.

Open the PWA from `https://` or `http://localhost`, sign in, then use **Settings → PWA notifications on this device → Enable on this device**. Each browser/device must opt in. The Settings page also has alarm and base-station choices, a test notification, and a disable action. The service worker displays notifications even when the PWA is closed. Alarm starts and recoveries, station disconnects and reconnects, and stalled or resumed reporting are covered. New alarms and station outage alerts require 15 minutes of continuous failure; recoveries follow only confirmed alerts.

## Quick start

```bash
cd backend
Copy-Item .env.example .env   # edit secrets, database, and email settings on Windows PowerShell
npm install
npm test
npm run dev            # G7 TCP on 0.0.0.0:6900, API on :3000

# Simulator (second terminal, behaves like Base Station)
npm run simulator                     # normal
SIM_MODE=high-temp npm run simulator  # high-temp | low-temp | high-humidity | low-battery | dropout | malformed | partial | multi

# Frontend (second terminal)
cd ../frontend && npm install && npm run dev  # http://localhost:5173, login admin/admin123
```

For macOS/Linux, use `cp .env.example .env` in place of `Copy-Item`.

Before deploying, change the seeded `admin/admin123` credentials and replace both JWT secrets.

Configure notification recipients after login under **Notifications**. Recipient
addresses are stored by the application and are not environment variables.

### Local ports

- `6900` — raw TCP listener used only by the physical G7 base station (or simulator).
- `3000` — backend HTTP API and WebSocket server used by the frontend.
- `5173` — Vite development frontend shown in the browser.

## Phases — WHAT / WHY / HOW / TEST

| Phase | What | Why | Test |
|---|---|---|---|
| 1 Foundation | `config`, `G7TcpServer`, `G7StreamBuffer`, `GET /health` | Prove `192.168.1.227:7000 → :6900` capture survives split/coalesced reads | `streamBuffer.test.ts` (5) + live log `G7 message received` |
| 2 Parser | Generic `A/H/B/K<num>` `g7Parser`, `g7StatusDecoder` (raw preserved) | New sensors must not require parser rewrite | `g7Parser.test.ts` incl. real capture + `X01` unknown |
| 3 Sensors | Live discovery + `sensorService.normalizeMessage`, `SensorState.lastSeen` | Show only sensor slots evidenced by real traffic; preserve ambiguous `Hxx` as a secondary channel | `sensorService.test.ts` incl. inactive-slot filtering and Sensor-06 discovery |
| 4 DB | Prisma Postgres schema + migrations; `FileStore` JSON fallback when `DATABASE_URL` unset | Persist users/config/alarms; run without PG in dev | Persistence round-trip, seed admin |
| 5-6 Alarms | `AlarmEngine` NORMAL→PENDING→ALARM→RECOVERED, 15-minute minimum confirmation, repeat dedup, `SENSOR_TIMEOUT_SECONDS` | No per-packet spam; catch silent sensors | `alarmEngine.test.ts` (delay/dedup/recovery/disconnect) |
| 7 Email | `NotificationProvider` + `BrevoEmailProvider(nodemailer)` + HTML templates; `EMAIL_ENABLED=false` logs only | Engine never depends on nodemailer directly | Disabled-mode log check, no secret logging |
| 8-9 API+Auth | REST per spec, `zod` validation, bcrypt+JWT, RBAC ADMIN/OPERATOR/VIEWER, rate-limit | Backend = source of truth; phone can edit safely | `configValidation.test.ts`, login/role checks |
| 10-12 UI+WS | Mobile-first dashboard/cards, detail, threshold forms (front+back validation), `/ws` live push | Manage thresholds from phone | `types.test.ts`, WS update without refresh |
| 13 Sim | `npm run simulator` all modes | Test without hardware | Manual matrix |
| 14 Deploy | `node-windows` service (primary) / PM2 fallback | Start after reboot, restart on failure, no nodemon | Service recovery check |

## Key endpoints

`GET /health` (public) · `POST /api/auth/login` · `GET /api/sensors` · `GET/PUT /api/sensors/:id/config` ·
`GET /api/sensors/:id/history` · `GET /api/alarms` · `GET /api/system/status` · `WS /ws`

`GET /api/readings/availability` · `GET /api/readings/report.pdf` · `POST/GET /api/readings/exports` ·
`GET /api/readings/exports/:id/download` · `GET /api/alarms/export.csv`

### Sensor history in Oracle Object Storage

Configure all five `OCI_OBJECT_*` values before startup. Each accepted frame's
active-sensor readings are written directly to a private Oracle Object Storage
object under `sensor-live/v1/`. No new raw frame or reading is written to the
backend disk or as a raw-reading row in PostgreSQL. The live snapshot updates
only after Oracle confirms the write. The original device `TM` is retained
without treating it as UTC; the server receipt time is UTC.

Oracle access is now required for ingestion. If it fails, the backend marks
`/health` degraded and closes the G7 connection for that frame instead of
showing an unsaved reading as live. Without any local durable buffer, frames
that the base station does not retry can be lost during an Oracle outage or
backend restart. Configure bucket replication/versioning and monitor health;
this design cannot guarantee uninterrupted capture during a network outage.
One object is written per reporting frame, so confirm Object Storage request
costs and retention for the expected sensor rate.

CSV exports are also prepared in Oracle Object Storage and expire after
`SENSOR_EXPORT_TTL_DAYS` (7 by default). Existing PostgreSQL rows and older
Oracle archives remain readable. Legacy local export files can still be
downloaded, but this version creates no new local exports. Migrating or
deleting previously saved local files is a separate operation and is not done
automatically.

The PDF report uses the selected History time period and includes every
configured, active sensor on one A4 landscape sheet. It draws Oracle live
readings and legacy PostgreSQL rows; older Oracle-only archive days are not
included in the graph report. A short threshold excursion, stale reading, or
station outage that clears before 15 minutes produces no alarm, buzzer, email,
or alarm push. Existing shorter alarm delays are treated as 15 minutes.

The app is installable as a PWA over HTTPS. Its service worker caches the app
shell and static assets, not authenticated API responses or live readings.
Generate icon PNGs after editing the thermometer SVG with `npm run icons` in
`frontend`, then run the normal frontend build.

## Production (Windows)

Option A (preferred): `service-install.ts` via node-windows — auto-start, restart, no UI.
Option B: `pm2 start ecosystem.config.json && pm2-save`. Never `nodemon` in prod.

## Known assumptions / unknowns

- Observed: packets may have a binary prefix before `#STA:` and end with a changing two-hex-digit checksum plus `;#` (for example `E6;#`); fields are `;`-separated and `TM` = YYMMDDhhmmss (no invented TZ).
- `Kxx` raw preserved; byte meanings **not** reverse-engineered (length change observed on battery pull).
- `A03/A04…0.000` treated as present-but-zero readings; absent keys = sensor not in frame.
- With a configured `DATABASE_URL`, application state is persisted in PostgreSQL through Prisma. For this Windows development host, the reachable `DIRECT_URL` session-pooler is used by the runtime client.
