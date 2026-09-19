# Pride Monitor

Independent monitoring and alerting for G7 wireless sensors. It continues to
receive data and evaluate alarms when the original G7 Client interface is closed.

## Pride Monitor dashboard

The React dashboard uses Tailwind CSS, shadcn-style Radix UI components,
Lucide icons, and Recharts. It includes responsive sensor cards, status filters,
an inspection drawer, alarm activity, notification settings, and browser sound controls.

- Counts and readings come from the live API; there are no seeded demo sensor cards.
- Critical indicates an active alarm; Warning indicates an offline sensor or an enabled threshold breach.
- Sparklines and CSV exports use up to 60 distinct readings observed in the current dashboard session. They reset when the dashboard is unmounted or reloaded; this is not long-term telemetry storage.
- The temperature gauge uses configured low/high limits. Without valid enabled limits, it shows an unavailable scale rather than inventing one.
- The API currently supplies sensor IDs, not hardware EUI identifiers.
- Existing authentication roles still govern configuration actions. Browser sound needs a user interaction to enable playback.

Frontend validation: run `npm test` and `npm run build` from `frontend`.

```
Sensors →(RF)→ Base Station →(TCP)→ Node backend → Parser → State → Alarms → Email
React UI → REST/WS → Node backend → State / Config / DB
```

> **Direct-Mode constraint:** the Base Station sends to **one** TCP client. Close the G7 Client before starting Node on `6900`
> (one listener per port). Production = `Base → Node → React`; original Client retired for monitoring.

## Requirements

- Node.js 22 or later
- A PostgreSQL database (Supabase PostgreSQL is supported)
- Optional: a configured email sender for alarm delivery

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

## Production (Windows)

Option A (preferred): `service-install.ts` via node-windows — auto-start, restart, no UI.
Option B: `pm2 start ecosystem.config.json && pm2-save`. Never `nodemon` in prod.

## Known assumptions / unknowns

- Observed: packets may have a binary prefix before `#STA:` and end with a changing two-hex-digit checksum plus `;#` (for example `E6;#`); fields are `;`-separated and `TM` = YYMMDDhhmmss (no invented TZ).
- `Kxx` raw preserved; byte meanings **not** reverse-engineered (length change observed on battery pull).
- `A03/A04…0.000` treated as present-but-zero readings; absent keys = sensor not in frame.
- With a configured `DATABASE_URL`, application state is persisted in PostgreSQL through Prisma. For this Windows development host, the reachable `DIRECT_URL` session-pooler is used by the runtime client.
