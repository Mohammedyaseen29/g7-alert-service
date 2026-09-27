import { expect, it } from 'vitest';
import { sensorReportParams } from './api.js';

it.each(['day', 'week', 'month', 'all'] as const)('sends %s as a backend-timed report preset', (period) => {
  const params = sensorReportParams({ period, sensorIds: ['01'] });
  expect(params.get('period')).toBe(period);
  expect(params.get('sensorIds')).toBe('01');
  expect(params.has('from')).toBe(false);
  expect(params.has('to')).toBe(false);
  expect(params.get('timeZone')).toBeTruthy();
});

it('sends explicit custom dates and a multi-sensor selection', () => {
  const params = sensorReportParams({
    from: '2026-09-25T08:00:00.000Z', to: '2026-09-26T10:00:00.000Z', sensorIds: ['01', '03'],
  });
  expect(params.get('from')).toBe('2026-09-25T08:00:00.000Z');
  expect(params.get('to')).toBe('2026-09-26T10:00:00.000Z');
  expect(params.get('sensorIds')).toBe('01,03');
  expect(params.has('period')).toBe(false);
});
