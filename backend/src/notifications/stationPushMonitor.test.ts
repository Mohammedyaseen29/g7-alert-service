import { expect, it } from 'vitest';
import { StationPushMonitor } from './stationPushMonitor.js';

it('reports connection loss and restored telemetry once per transition', () => {
  const titles: string[] = [];
  const monitor = new StationPushMonitor(120_000, (event) => titles.push(event.title));
  const start = Date.parse('2026-09-24T00:00:00Z');
  monitor.update(0, null, start);
  monitor.update(1, null, start);
  monitor.update(1, new Date(start + 1_000).toISOString(), start + 1_000);
  expect(titles).toEqual([]);
  monitor.update(1, new Date(start + 1_000).toISOString(), start + 122_000);
  monitor.update(1, new Date(start + 1_000).toISOString(), start + 130_000);
  monitor.update(1, new Date(start + 131_000).toISOString(), start + 131_000);
  monitor.update(0, new Date(start + 131_000).toISOString(), start + 132_000);
  monitor.update(1, new Date(start + 131_000).toISOString(), start + 133_000);
  expect(titles).toEqual([
    'Base station not reporting', 'Base station reporting again',
    'Base station disconnected', 'Base station reconnected',
  ]);
});
