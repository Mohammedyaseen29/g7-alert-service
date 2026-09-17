// Windows Service installer (primary production option). Run as Administrator:
//   cd backend && npm install -g node-windows (once) && npx tsx ../service-install.ts
// Service: auto-start after reboot, restart on failure, no UI, no nodemon.
import { Service } from 'node-windows';
import path from 'node:path';

const svc = new Service({
  name: 'G7 Alert Service',
  description: 'Independent G7 sensor monitoring, alarms and Brevo email alerts',
  script: path.join(process.cwd(), 'backend', 'dist', 'index.js'),
  nodeOptions: [],
  env: [{ name: 'NODE_ENV', value: 'production' }],
});
svc.on('install', () => svc.start());
svc.install();
