import type { NormalizedState } from './sensorService.js';

// In-memory live readings; history persisted via DB/file store.
export class SensorState {
  private state: NormalizedState | null = null;

  update(next: NormalizedState): NormalizedState {
    if (!this.state) {
      this.state = next;
      return this.state;
    }
    // Merge per-sensor lastSeen so absent sensors keep old lastSeen (timeout detection).
    const merged: NormalizedState = { ...next, sensors: { ...this.state.sensors, ...next.sensors } };
    // Station id may change rarely; keep latest.
    this.state = merged;
    return this.state;
  }

  snapshot(): NormalizedState | null {
    return this.state;
  }
}
