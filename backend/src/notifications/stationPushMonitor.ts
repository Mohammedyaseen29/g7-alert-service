export type StationPushEvent = { title: string; body: string; tag: string };

export class StationPushMonitor {
  private connected = false;
  private fresh = false;
  private everConnected = false;
  private everReported = false;
  private staleNotified = false;

  constructor(private timeoutMs: number, private emit: (event: StationPushEvent) => void) {}

  update(connectedCount: number, lastMessageAt: string | null, now = Date.now()): void {
    const connected = connectedCount > 0;
    const fresh = connected && Boolean(lastMessageAt && now - Date.parse(lastMessageAt) <= this.timeoutMs);
    if (connected !== this.connected) {
      if (!connected) {
        this.emit({ title: 'Base station disconnected', body: 'The G7 base station connection was lost.', tag: 'station-connection' });
        this.staleNotified = false;
      } else if (this.everConnected) {
        this.emit({ title: 'Base station reconnected', body: 'The G7 base station connected again.', tag: 'station-connection' });
      }
      this.everConnected = this.everConnected || connected;
    } else if (connected && this.fresh && !fresh && this.everReported) {
      this.emit({ title: 'Base station not reporting', body: 'The base station is connected but sensor data has stopped arriving.', tag: 'station-data' });
      this.staleNotified = true;
    } else if (connected && !this.fresh && fresh && this.staleNotified) {
      this.emit({ title: 'Base station reporting again', body: 'Sensor data is arriving again.', tag: 'station-data' });
      this.staleNotified = false;
    }
    this.connected = connected;
    this.fresh = fresh;
    this.everReported = this.everReported || fresh;
  }
}
