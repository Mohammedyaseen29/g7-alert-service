import { expect, it, vi } from 'vitest';
import { buildSensorReport, type ReportSource } from './reportPdf.js';

it('makes a readable summary and one chart page per selected sensor', async () => {
  const from = new Date('2026-09-26T00:00:00.000Z');
  const to = new Date('2026-09-27T00:00:00.000Z');
  const scan = vi.fn(async function* (_from: Date, _to: Date, _sensorIds: string[]) {
    yield { sensorId: '01', receivedAt: new Date(from.getTime() + 60_000), temperature: 20, temperature2: null, humidity: 55 };
    yield { sensorId: '01', receivedAt: new Date(from.getTime() + 61_000), temperature: 35, temperature2: null, humidity: 57 };
    yield { sensorId: '03', receivedAt: new Date(from.getTime() + 62_000), temperature: 90, temperature2: null, humidity: null };
  });
  const source: ReportSource = { scan };
  const pdf = await buildSensorReport(source, [
    { id: '01', name: 'Cold Room' },
    { id: '02', name: 'Packing Area' },
  ], from, to, { timeZone: 'Asia/Kolkata', generatedAt: to });
  const text = pdf.toString('ascii');

  expect(scan).toHaveBeenCalledWith(from, to, ['01', '02']);
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  expect(text).toContain('/Count 3');
  expect(text).toContain('Cold Room');
  expect(text).toContain('Packing Area');
  expect(text).not.toContain('Sensor 03');
  expect(text).toContain('Time zone: Asia/Kolkata');
  expect(text).toContain('26 Sept 2026 05:30');
  expect(text).toContain('Max 35.0\\260C');
  expect(text).toContain('No readings');
  expect(text).toContain('Page 3 of 3');
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
});

it('paginates summary rows so many sensor names remain legible', async () => {
  const from = new Date('2026-09-26T00:00:00.000Z');
  const to = new Date('2026-09-27T00:00:00.000Z');
  const source: ReportSource = { async *scan() {} };
  const sensors = Array.from({ length: 20 }, (_, index) => ({ id: String(index), name: `Room ${index + 1}` }));
  const pdf = await buildSensorReport(source, sensors, from, to);
  const text = pdf.toString('ascii');
  expect(text).toContain('/Count 23'); // Three summary pages and one chart page per sensor.
  expect(text).toContain('Room 20');
  expect(text).toContain('Page 23 of 23');
});
