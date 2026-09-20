import type { AlarmEvent } from '../alarms/alarmEngine.js';

export function alarmSubject(a: AlarmEvent): string {
  return `[Pride Monitoring ALERT] Sensor ${a.sensorId} ${label(a)}`;
}
export function recoverySubject(a: AlarmEvent): string {
  return `[Pride Monitoring RECOVERED] Sensor ${a.sensorId} ${label(a)} Normal`;
}

function label(a: AlarmEvent): string {
  switch (a.kind) {
    case 'temp_high': return 'High Temperature';
    case 'temp_low': return 'Low Temperature';
    case 'temp2_high': return 'High Temperature (Channel 2)';
    case 'temp2_low': return 'Low Temperature (Channel 2)';
    case 'humidity_high': return 'High Humidity';
    case 'humidity_low': return 'Low Humidity';
    case 'battery_low': return 'Low Battery';
    case 'sensor_disconnected': return 'Disconnected';
  }
}

export function alarmHtml(a: AlarmEvent, ctx: { sensorName?: string; battery?: number; stationId: string }): string {
  return `<div style="font-family:Arial,sans-serif;max-width:600px">
<h2 style="color:#b91c1c">${alarmSubject(a)}</h2>
<table cellpadding="6" cellspacing="0" border="1">
<tr><td><b>Station</b></td><td>${ctx.stationId}</td></tr>
<tr><td><b>Sensor</b></td><td>${a.sensorId} ${ctx.sensorName ?? ''}</td></tr>
<tr><td><b>Alarm</b></td><td>${label(a)}</td></tr>
<tr><td><b>Value</b></td><td>${a.value ?? 'n/a'}</td></tr>
<tr><td><b>Threshold</b></td><td>${a.threshold ?? 'n/a'}</td></tr>
<tr><td><b>Battery</b></td><td>${ctx.battery ?? 'n/a'}</td></tr>
<tr><td><b>Detected</b></td><td>${a.startedAt}</td></tr>
</table><p>${a.message}</p></div>`;
}

export function recoveryHtml(a: AlarmEvent, ctx: { sensorName?: string; stationId: string }): string {
  return `<div style="font-family:Arial,sans-serif;max-width:600px">
<h2 style="color:#15803d">${recoverySubject(a)}</h2>
<p>Station ${ctx.stationId}, sensor ${a.sensorId} ${ctx.sensorName ?? ''} recovered at ${a.recoveredAt ?? ''}.</p>
<p>${a.message}</p></div>`;
}
