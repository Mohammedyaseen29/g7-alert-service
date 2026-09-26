export type StationPushEvent = { title: string; body: string; tag: string };

export class StationPushMonitor {
  private everConnected = false;
  private everReported = false;
  private disconnectedSince: number | null = null;
  private staleSince: number | null = null;
  private disconnectNotified = false;
  private staleNotified = false;

  constructor(private timeoutMs: number, private emit: (event: StationPushEvent) => void, private confirmationMs = 15 * 60 * 1000) {}

  update(connectedCount: number, lastMessageAt: string | null, now = Date.now()): void {
    const connected = connectedCount > 0;
    const messageTime = lastMessageAt ? Date.parse(lastMessageAt) : NaN;
    const fresh = connected && Number.isFinite(messageTime) && now - messageTime <= this.timeoutMs;

    if (connected) {
      if (this.disconnectNotified) this.emit({ title: 'Base station reconnected', body: 'The G7 base station connected again.', tag: 'station-connection' });
      this.disconnectedSince = null;
      this.disconnectNotified = false;
      this.everConnected = true;
    } else if (this.everConnected) {
      this.disconnectedSince ??= now;
      if (!this.disconnectNotified && now - this.disconnectedSince >= this.confirmationMs) {
        this.emit({ title: 'Base station disconnected', body: 'The G7 base station connection was lost for 15 minutes.', tag: 'station-connection' });
        this.disconnectNotified = true;
      }
    }

    if (fresh) {
      if (this.staleNotified) this.emit({ title: 'Base station reporting again', body: 'Sensor data is arriving again.', tag: 'station-data' });
      this.staleSince = null;
      this.staleNotified = false;
      this.everReported = true;
    } else if (connected && this.everReported) {
      this.staleSince ??= now;
      if (!this.staleNotified && now - this.staleSince >= this.confirmationMs) {
        this.emit({ title: 'Base station not reporting', body: 'The base station has not sent sensor data for 15 minutes.', tag: 'station-data' });
        this.staleNotified = true;
      }
    } else if (!connected && !this.staleNotified) {
      this.staleSince = null;
    }
  }
}
