import { describe, it, expect } from 'vitest';
import { G7StreamBuffer } from '../tcp/streamBuffer.js';

const OPTS = { maxMessageBytes: 65536, maxBufferBytes: 1048576 };
const F1 = '#STA:000000,111;L:381;TM:260916214100;A01:26.56;EE;#';
const HARDWARE_FRAME = '#STA:00000,111;L:381;TM:260917230004;A01:28.00;A02:28.64;E6;#';

describe('Phase 1: G7 framing / TCP stream handling', () => {
  it('single complete message', () => {
    const b = new G7StreamBuffer(OPTS);
    expect(b.push(F1)).toEqual([F1]);
  });
  it('multiple messages in one read', () => {
    const b = new G7StreamBuffer(OPTS);
    expect(b.push(F1 + F1)).toEqual([F1, F1]);
  });
  it('split across reads', () => {
    const b = new G7StreamBuffer(OPTS);
    const half = Math.floor(F1.length / 2);
    expect(b.push(F1.slice(0, half))).toEqual([]);
    expect(b.push(F1.slice(half))).toEqual([F1]);
  });
  it('garbage before frame is skipped, not fatal', () => {
    const b = new G7StreamBuffer(OPTS);
    expect(b.push('GARBAGE' + F1)).toEqual([F1]);
    expect(b.malformedSkipped).toBeGreaterThan(0);
  });
  it('accepts a changing checksum and skips the hardware binary prefix', () => {
    const b = new G7StreamBuffer(OPTS);
    const binaryPrefix = Buffer.from([0x0b, 0x68, 0x58, 0xe6, 0x00, 0x00]);
    expect(b.push(Buffer.concat([binaryPrefix, Buffer.from(HARDWARE_FRAME)]))).toEqual([HARDWARE_FRAME]);
  });
  it('handles a checksum terminator split across TCP reads', () => {
    const b = new G7StreamBuffer(OPTS);
    expect(b.push(HARDWARE_FRAME.slice(0, -2))).toEqual([]);
    expect(b.push(HARDWARE_FRAME.slice(-2))).toEqual([HARDWARE_FRAME]);
  });
  it('unterminated garbage yields nothing yet', () => {
    const b = new G7StreamBuffer(OPTS);
    expect(b.push('#STA:PARTIAL')).toEqual([]);
  });
});

