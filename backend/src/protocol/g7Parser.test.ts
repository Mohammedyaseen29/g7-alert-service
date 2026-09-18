import { describe, it, expect } from 'vitest';
import { parseG7Message } from '../protocol/g7Parser.js';

const REAL = '#STA:000000,111;L:381;TM:260916214100;A01:26.56;A02:27.12;A03:0.000;A04:0.000;A05:27.32;A06:0.000;A07:0.000;A08:0.000;H01:0.000;H02:73.83;H03:0.000;H04:0.000;H05:27.13;H06:0.000;H07:0.000;H08:0.000;B01:3.670;B02:3.660;B03:0.000;B04:0.000;B05:3.630;B06:0.000;B07:0.000;B08:0.000;K01:03000000;K02:03010100;K03:00000000;K04:00000000;K05:03000700;K06:00000000;K07:00000000;K08:00000000;EE;#';

describe('Phase 2: generic G7 parser', () => {
  it('parses real capture generically', () => {
    const m = parseG7Message(REAL);
    expect(m.stationId).toBe('000000');
    expect(m.fields['A01']).toBe('26.56');
    expect(m.fields['H02']).toBe('73.83');
    expect(m.fields['B05']).toBe('3.630');
    expect(m.fields['K01']).toBe('03000000');
    expect(m.rawMessage).toBe(REAL);
  });
  it('preserves unknown future fields', () => {
    const m = parseG7Message('#STA:000000,111;X01:12345;A01:1.0;EE;#');
    expect(m.fields['X01']).toBe('12345');
    expect(m.unknownFields['X01']).toBe('12345');
  });
  it('accepts the variable checksum emitted by real hardware', () => {
    const m = parseG7Message('#STA:00000,111;L:381;TM:260917230004;A01:28.00;A02:28.64;E6;#');
    expect(m.stationId).toBe('00000');
    expect(m.fields['A02']).toBe('28.64');
  });
  it('rejects bad frame', () => {
    expect(() => parseG7Message('GARBAGE')).toThrow();
  });
});
