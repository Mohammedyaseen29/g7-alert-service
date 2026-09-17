// Status decoder abstraction. Exact K-byte meaning is NOT reverse-engineered.
// Preserve raw; only expose conservative heuristics + length-change signal.
export interface DecodedStatus {
  raw: string;
  lengthChanged?: boolean;
  note: string;
}

export function decodeStatus(raw: string, previousRaw?: string): DecodedStatus {
  if (!previousRaw) return { raw, note: 'first observation, raw preserved' };
  if (raw.length !== previousRaw.length) {
    return { raw, lengthChanged: true, note: `length ${previousRaw.length}->${raw.length}; observed on battery removal/insertion` };
  }
  return { raw, note: raw === previousRaw ? 'unchanged' : 'value changed, meaning unknown' };
}
