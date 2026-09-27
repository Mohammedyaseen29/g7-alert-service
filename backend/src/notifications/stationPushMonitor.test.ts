import { expect, it } from 'vitest';
import { StationPushMonitor } from './stationPushMonitor.js';

it('reports station outages only after 15 continuous minutes, then reports recovery', () => {
  const titles: string[] = [];
  const monitor = new StationPushMonitor(120_000, (event) => titles.push(event.title));
  const start = Date.parse('2026-09-24T00:00:00Z');
  monitor.update(0, null, start);
  monitor.update(1, null, start);
  monitor.update(1, new Date(start + 1_000).toISOString(), start + 1_000);
  expect(titles).toEqual([]);
  monitor.update(1, new Date(start + 1_000).toISOString(), start + 122_000);
  monitor.update(1, new Date(start + 1_000).toISOString(), start + 122_000 + 899_999);
  expect(titles).toEqual([]);
  monitor.update(1, new Date(start + 1_000).toISOString(), start + 122_000 + 900_000);
  monitor.update(1, new Date(start + 1_023_000).toISOString(), start + 1_023_000);
  monitor.update(0, new Date(start + 1_023_000).toISOString(), start + 1_024_000);
  monitor.update(0, new Date(start + 1_023_000).toISOString(), start + 1_024_000 + 899_999);
  expect(titles).toEqual(['Base station not reporting', 'Base station reporting again']);
  monitor.update(0, new Date(start + 1_023_000).toISOString(), start + 1_024_000 + 900_000);
  monitor.update(1, new Date(start + 1_925_000).toISOString(), start + 1_925_000);
  expect(titles).toEqual([
    'Base station not reporting', 'Base station reporting again',
    'Base station disconnected', 'Base station reconnected',
  ]);
});

it('cancels a short station outage without sending an alarm or recovery', () => {
  const titles: string[] = [];
  const monitor = new StationPushMonitor(120_000, (event) => titles.push(event.title));
  const start = Date.parse('2026-09-24T00:00:00Z');
  monitor.update(1, new Date(start).toISOString(), start);
  monitor.update(0, new Date(start).toISOString(), start + 1_000);
  monitor.update(1, new Date(start + 2_000).toISOString(), start + 2_000);
  expect(titles).toEqual([]);
});
