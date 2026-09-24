# Pride Monitor

Independent monitoring and alerting for G7 wireless sensors. It continues to
receive data and evaluate alarms when the original G7 Client interface is closed.

## Pride Monitor dashboard

The React dashboard uses Tailwind CSS, shadcn-style Radix UI components,
Lucide icons, and Recharts. It includes responsive sensor cards, status filters,
an inspection drawer, alarm activity, notification settings, and browser sound controls.

- Counts and readings come from the live API; there are no seeded demo sensor cards.
- Critical indicates an active alarm; Warning indicates an offline sensor or an enabled threshold breach.
- Sparklines and the inspection drawer's quick CSV use up to 60 distinct readings observed in the current dashboard session. The separate **History** page exports durable server-side readings, including older Oracle Object Storage archives.
- The temperature gauge uses configured low/high limits. Without valid enabled limits, it shows an unavailable scale rather than inventing one.
- The API currently supplies sensor IDs, not hardware EUI identifiers.
- Existing authentication roles still govern configuration actions. Browser sound needs a user interaction to enable playback.

Frontend validation: run `npm test` and `npm run build` from `frontend`.

```
Sensors →(RF)→ Base Station →(TCP)→ Node backend → Parser → State → Alarms → Email
React PWA → REST/WS → Node backend → State / Config / DB
Browser subscription → PostgreSQL → Web Push → PWA service worker → device notification
G7 frames → fsynced local spool → partitioned PostgreSQL sensor_readings
Closed PostgreSQL partitions → verified Parquet files in Oracle Object Storage
History filters → background CSV.gz job → short-lived Oracle download URL
```

> **Direct-Mode constraint:** the Base Station sends to **one** TCP client. Close the G7 Client before starting Node on `6900`
> (one listener per port). Production = `Base → Node → React`; original Client retired for monitoring.

## Requirements

- Node.js 22 or later
- A PostgreSQL database (Supabase PostgreSQL is supported)
- Optional: a configured email sender for alarm delivery

## PWA push notifications

Set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` in the backend environment. Generate a VAPID key pair once with `npx web-push generate-vapid-keys`. Keep the same key pair across restarts and deployments, because replacing it invalidates existing browser subscriptions. Push subscriptions are stored in PostgreSQL.

Open the PWA from `https://` or `http://localhost`, sign in, then use **Settings → PWA notifications on this device → Enable on this device**. Each browser/device must opt in. The Settings page also has alarm and base-station choices, a test notification, and a disable action. The service worker displays notifications even when the PWA is closed. Alarm starts and recoveries, station disconnects and reconnects, and stalled or resumed reporting are covered.

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
| 5-6 Alarms | `AlarmEngine` NORMAL→PENDING→ALARM→RECOVERED, `ALARM_DELAY_SECONDS`, repeat dedup, `SENSOR_TIMEOUT_SECONDS` | No per-packet spam; catch silent sensors | `alarmEngine.test.ts` (delay/dedup/recovery/disconnect) |
| 7 Email | `NotificationProvider` + `BrevoEmailProvider(nodemailer)` + HTML templates; `EMAIL_ENABLED=false` logs only | Engine never depends on nodemailer directly | Disabled-mode log check, no secret logging |
| 8-9 API+Auth | REST per spec, `zod` validation, bcrypt+JWT, RBAC ADMIN/OPERATOR/VIEWER, rate-limit | Backend = source of truth; phone can edit safely | `configValidation.test.ts`, login/role checks |
| 10-12 UI+WS | Mobile-first dashboard/cards, detail, threshold forms (front+back validation), `/ws` live push | Manage thresholds from phone | `types.test.ts`, WS update without refresh |
| 13 Sim | `npm run simulator` all modes | Test without hardware | Manual matrix |
| 14 Deploy | `node-windows` service (primary) / PM2 fallback | Start after reboot, restart on failure, no nodemon | Service recovery check |

## Key endpoints

`GET /health` (public) · `POST /api/auth/login` · `GET /api/sensors` · `GET/PUT /api/sensors/:id/config` ·
`GET /api/sensors/:id/history` · `GET /api/alarms` · `GET /api/system/status` · `WS /ws`

`GET /api/readings/availability` · `POST/GET /api/readings/exports` ·
`GET /api/readings/exports/:id/download` · `GET /api/alarms/export.csv`

### Sensor history and Oracle Object Storage

The backend now creates a separate, daily partitioned `sensor_readings` table in
PostgreSQL. Each sensor present in a received G7 frame gets one raw reading row;
the carried-forward live snapshot is never inserted as new data. It stores both
the server receipt time in UTC and the unmodified G7 `TM` value. The base
station's timezone has not been established, so `TM` is not treated as a UTC
timestamp. History begins when this server-side capture is deployed; the old
browser-only trend cannot be backfilled from the application database.
The application database role needs permission to create the initial history
tables and new daily partitions. Apply the existing base schema first; do not
run `prisma db push` after history capture is enabled, because Prisma cannot
create this partitioned table from its model alone.

Set `DATA_DIR` to a persistent disk path. Incoming frames are fsynced to a
bounded local write-ahead log before PostgreSQL processing. A failed database
write leaves the frame pending for retry and shows `degraded` in `/health`.
This protects against process restarts and temporary database outages on the
same host. It cannot recover measurements the base station never delivered or
a failed host disk; confirm whether the hardware supports replay/buffering if
end-to-end losslessness is required.

Create a **private Standard-tier** bucket in Oracle Object Storage and an OCI
Customer Secret Key with object read/write permissions. Set all five
`OCI_OBJECT_*` values in `backend/.env` (namespace, region, bucket, access key,
secret key). The backend uses Oracle's S3 compatibility endpoint. Leave them
all unset only during a staged rollout: PostgreSQL capture still works, but
archiving and the History CSV button are disabled. Do not put credentials in
frontend environment variables.

`SENSOR_HOT_DAYS` defaults to 90. After that period, a closed UTC day is
written in bounded Parquet files, uploaded to Oracle, downloaded and checksum
verified, then recorded in the archive manifest. Only then is its PostgreSQL
partition removed. Archive failure keeps the database partition. No lifecycle
rule should delete `sensor-history/` objects while users require all-time
history. Generated `sensor-exports/` CSV.gz files are removed after
`SENSOR_EXPORT_TTL_DAYS` (7 by default); users receive 5-minute signed
download URLs. Monitor database disk, spool bytes, archive errors, and export
failures in production.

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
