import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';

export class LiveBus {
  private wss: WebSocketServer | null = null;

  attach(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'hello', at: new Date().toISOString() }));
    });
  }

  broadcast(msg: unknown) {
    if (!this.wss) return;
    const data = JSON.stringify(msg);
    for (const c of this.wss.clients) {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    }
  }
}
