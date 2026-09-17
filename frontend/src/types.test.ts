import { describe, it, expect } from 'vitest';
import { validateConfig } from './types.js';

describe('frontend: threshold validation', () => {
  it('rejects high <= low', () => {
    expect(validateConfig({ temperature: { high: 10, low: 30 } })).not.toHaveLength(0);
  });
  it('accepts sane config', () => {
    expect(validateConfig({ temperature: { high: 30, low: 10 }, humidity: { high: 80, low: 20 }, battery: { low: 3.3 } })).toHaveLength(0);
  });
});
