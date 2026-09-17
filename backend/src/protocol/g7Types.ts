// Generic G7 types. Parser stays generic: A/H/B/K<num> + STA/L/TM.
// Sensor-specific meaning lives in sensor configuration, not here.

export interface G7RawField {
  key: string; // e.g. "A02"
  value: string; // raw string value
}

export interface G7ParsedMessage {
  rawMessage: string;
  stationId: string;
  link?: string;
  timestamp?: string; // raw TM value, e.g. "260916214100"
  fields: Record<string, string>; // generic raw fields: A01, H02, B01, K01...
  unknownFields: Record<string, string>; // future-proof preserved fields
}
