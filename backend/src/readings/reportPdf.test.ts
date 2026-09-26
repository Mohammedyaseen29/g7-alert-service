import { expect, it } from 'vitest';
import { buildSensorReport, type ReportSource } from './reportPdf.js';

it('fits every active sensor trend on one A4 landscape PDF page', async () => {
  const from = new Date('2026-09-26T00:00:00.000Z');
  const to = new Date('2026-09-27T00:00:00.000Z');
  const source: ReportSource = {
    async *scan() {
      yield { sensorId: '01', receivedAt: from, temperature: 20, temperature2: null, humidity: 55 };
      yield { sensorId: '01', receivedAt: new Date(from.getTime() + 3_600_000), temperature: 22, temperature2: null, humidity: 57 };
      yield { sensorId: '02', receivedAt: from, temperature: 18, temperature2: 19, humidity: null };
    },
  };
  const sensors = Array.from({ length: 24 }, (_, index) => ({ id: String(index + 1).padStart(2, '0'), name: `Sensor ${String(index + 1).padStart(2, '0')}` }));
  const pdf = await buildSensorReport(source, sensors, from, to);
  const text = pdf.toString('ascii');
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  expect(text).toContain('/MediaBox [0 0 841.89 595.28]');
  expect(text).toContain('/Count 1');
  expect(text).toContain('Sensor 01');
  expect(text).toContain('Sensor 24');
  expect(text).toContain('No readings in this period');
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
});
