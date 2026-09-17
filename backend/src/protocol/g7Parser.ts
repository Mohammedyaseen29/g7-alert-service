import type { G7ParsedMessage } from './g7Types.js';
import { FRAME_END, FRAME_START } from '../tcp/streamBuffer.js';

const GENERIC_RE = /^([AHBK])(\d{2})$/;
const CORE_KEYS = new Set(['STA', 'L', 'TM']);

// Parses "#STA:000000,111;L:381;TM:260916214100;A01:26.56;...;EE;#"
// Never invents sensor meaning; preserves unknown fields.
export function parseG7Message(raw: string): G7ParsedMessage {
  if (!raw.startsWith(FRAME_START) || !raw.endsWith(FRAME_END)) {
    throw new Error('Invalid G7 frame boundaries');
  }
  const inner = raw.slice(FRAME_START.length, -FRAME_END.length);
  const segments = inner.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
  const fields: Record<string, string> = {};
  const unknownFields: Record<string, string> = {};
  let stationId = '';
  let link: string | undefined;
  let timestamp: string | undefined;

  for (const [i, seg] of segments.entries()) {
    const idx = seg.indexOf(':');
    if (idx === -1) {
      if (i === 0) {
        // First segment after "#STA:" carries the station id without a key,
        // e.g. "#STA:000000,111;..." -> "000000,111".
        stationId = seg.split(',')[0] ?? seg;
        fields['STA'] = seg;
        continue;
      }
      unknownFields[seg] = '';
      continue;
    }
    const key = seg.slice(0, idx).trim();
    const value = seg.slice(idx + 1).trim();
    if (key === 'STA') {
      stationId = value.split(',')[0] ?? value;
      fields[key] = value;
    } else if (key === 'L') {
      link = value;
      fields[key] = value;
    } else if (key === 'TM') {
      timestamp = value;
      fields[key] = value;
    } else if (GENERIC_RE.test(key) || CORE_KEYS.has(key)) {
      fields[key] = value;
    } else {
      // Future sensor encodings (e.g. X01:12345) preserved, never fatal.
      unknownFields[key] = value;
      fields[key] = value;
    }
  }
  if (!stationId) throw new Error('Missing STA station id');
  return { rawMessage: raw, stationId, link, timestamp, fields, unknownFields };
}

// Decodes "TM:260916214100" as YYMMDDhhmmss (best-effort, no invented TZ).
export function decodeG7Timestamp(tm?: string): Date | null {
  if (!tm || !/^\d{12}$/.test(tm)) return null;
  const yy = Number(tm.slice(0, 2));
  const mm = Number(tm.slice(2, 4));
  const dd = Number(tm.slice(4, 6));
  const hh = Number(tm.slice(8 - 2, 10 - 2)) === 0 ? 0 : Number(tm.slice(6, 8));
  const min = Number(tm.slice(8, 10));
  const ss = Number(tm.slice(10, 12));
  const d = new Date(2000 + yy, mm - 1, dd, Number(tm.slice(6, 8)), min, ss);
  void hh;
  return isNaN(d.getTime()) ? null : d;
}
