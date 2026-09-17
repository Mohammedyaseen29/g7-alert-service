import { describe, it, expect } from 'vitest';
import { parseG7Message } from '../protocol/g7Parser.js';
import { discoverSensorDefinitions, normalizeMessage, type SensorDefinition } from './sensorService.js';

const REAL = '#STA:000000,111;L:381;TM:260916214100;A01:26.56;A02:27.12;A05:27.32;H02:73.83;B01:3.670;B02:3.660;B05:3.630;K01:03000000;K02:03010100;K05:03000700;EE;#';

describe('Phase 3: sensor normalization via config', () => {
  it('discovers only slots with evidence of a real sensor', () => {
    const message = parseG7Message(`${REAL.replace('EE;#', '')}A03:0.000;H03:0.000;B03:0.000;K03:00000000;EE;#`);
    const defs = discoverSensorDefinitions(message, []);
    expect(defs.map((sensor) => sensor.id)).toEqual(['01', '02', '05']);
    expect(defs.find((sensor) => sensor.id === '02')?.fields.secondary).toBe('H02');
    expect(defs.find((sensor) => sensor.id === '02')?.fields.humidity).toBeUndefined();
  });

  it('normalizes discovered values without inventing H-channel meaning', () => {
    const message = parseG7Message(REAL);
    const defs = discoverSensorDefinitions(message, []);
    const n = normalizeMessage(message, defs);
    expect(n.sensors['01'].temperature).toBeCloseTo(26.56);
    expect(n.sensors['02'].secondary).toBeCloseTo(73.83);
    expect(n.sensors['02'].humidity).toBeUndefined();
    expect(n.sensors['05'].temperature).toBeCloseTo(27.32);
    expect(n.sensors['01'].rawStatus).toBe('03000000');
  });

  it('discovers a future sensor without code or parser changes', () => {
    const message = parseG7Message('#STA:000000,111;A06:22.5;B06:3.7;K06:03000000;EE;#');
    const defs: SensorDefinition[] = discoverSensorDefinitions(message, []);
    const n = normalizeMessage(message, defs);
    expect(n.sensors['06'].temperature).toBeCloseTo(22.5);
  });

  it('uses an H channel as temperature only after explicit configuration', () => {
    const message = parseG7Message('#STA:000000,111;A05:27.3;H05:26.8;B05:3.6;K05:03000700;EE;#');
    const defs: SensorDefinition[] = [{ id: '05', name: 'Cold room probe', type: 'temperature2', fields: { temperature: 'A05', temperature2: 'H05', battery: 'B05', status: 'K05' } }];
    const n = normalizeMessage(message, defs);
    expect(n.sensors['05'].temperature2).toBeCloseTo(26.8);
    expect(n.sensors['05'].humidity).toBeUndefined();
  });
});
