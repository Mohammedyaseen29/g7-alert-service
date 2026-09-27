import { expect, it } from 'vitest';
import { resolveReportRange } from './reportRange.js';

const serverNow = new Date('2026-09-27T12:00:00.000Z');

it.each([
  ['day', 1], ['week', 7], ['month', 30],
] as const)('calculates the %s preset using the backend clock', (period, days) => {
  const range = resolveReportRange({ period }, serverNow);
  expect(range.to).toEqual(serverNow);
  expect(range.from).toEqual(new Date(serverNow.getTime() - days * 86_400_000));
});

it('uses the selected sensor history start for All available', () => {
  const first = new Date('2026-01-02T09:10:11.000Z');
  expect(resolveReportRange({ period: 'all' }, serverNow, first)).toEqual({ from: first, to: serverNow });
});

it('keeps valid custom dates and clips a future custom end to the backend clock', () => {
  const from = '2026-09-25T08:00:00.000Z';
  const to = '2026-09-26T10:00:00.000Z';
  expect(resolveReportRange({ from, to }, serverNow)).toEqual({ from: new Date(from), to: new Date(to) });
  expect(resolveReportRange({ from, to: '2026-09-27T12:10:00.000Z' }, serverNow))
    .toEqual({ from: new Date(from), to: serverNow });
});

it('translates a cached PWA 24-hour request to backend time', () => {
  const range = resolveReportRange({
    from: '2026-09-26T12:10:00.000Z', to: '2026-09-27T12:10:00.000Z',
  }, serverNow);
  expect(range).toEqual({ from: new Date('2026-09-26T12:00:00.000Z'), to: serverNow });
});

it('rejects a custom period that begins after the backend clock', () => {
  expect(() => resolveReportRange({ from: '2026-09-27T12:01:00.000Z', to: '2026-09-27T13:00:00.000Z' }, serverNow)).toThrow();
});
