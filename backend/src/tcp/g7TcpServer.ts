import net from 'node:net';
import { logger } from '../config/logger.js';
import { G7StreamBuffer } from './streamBuffer.js';

export interface TcpServerStats {
  listening: boolean;
  host: string;
  port: number;
  connectedBaseStations: number;
  lastG7MessageAt: string | null;
  totalMessages: number;
  parserErrors: number;
  startedAt: string;
}

export interface G7TcpCallbacks {
  onMessage: (raw: string, remote: string) => void | Promise<void>;
  onParserError?: (err: Error, raw: string) => void;
  onConnectionChange?: (connected: number) => void;
  onTelemetry?: () => void;
}

export class G7TcpServer {
  private server: net.Server | null = null;
  private sockets = new Set<net.Socket>();
  private lastG7MessageAt: string | null = null;
  private totalMessages = 0;
  private parserErrors = 0;
  private startedAt = new Date().toISOString();

  constructor(
    private host: string,
    private port: number,
    private opts: { maxMessageBytes: number; maxBufferBytes: number },
    private cb: G7TcpCallbacks,
  ) {}

  async listen(): Promise<void> {
    this.server = net.createServer((socket) => {
      const remote = `${socket.remoteAddress}:${socket.remotePort}`;
      logger.info({ remote }, 'G7 base station connected');
      this.sockets.add(socket);
      this.cb.onConnectionChange?.(this.sockets.size);
      const framer = new G7StreamBuffer(this.opts);
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        socket.pause();
        void (async () => {
          let frames: string[];
          try {
            frames = framer.push(chunk.toString());
          } catch (err) {
            this.parserErrors++;
            logger.warn({ err, remote }, 'framer error');
            socket.resume();
            return;
          }
          for (const raw of frames) {
            this.totalMessages++;
            logger.debug({ remote, len: raw.length }, 'G7 message received');
            try {
              await this.cb.onMessage(raw, remote);
              this.lastG7MessageAt = new Date().toISOString();
              this.cb.onTelemetry?.();
            } catch (err) {
              this.parserErrors++;
              this.cb.onParserError?.(err as Error, raw);
              logger.error({ err, remote }, 'G7 frame processing failed; closing connection');
              socket.destroy();
              return;
            }
          }
          socket.resume();
        })();
      });
      socket.on('close', () => {
        this.sockets.delete(socket);
        this.cb.onConnectionChange?.(this.sockets.size);
        logger.info({ remote }, 'G7 base station disconnected');
      });
      socket.on('error', (err) => {
        logger.warn({ err, remote }, 'G7 socket error');
      });
    });
    this.server.on('error', (err) => logger.error({ err }, 'G7 TCP server error'));
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, this.host, () => {
        logger.info({ host: this.host, port: this.port }, 'G7 TCP listening (close G7 Client: one listener per port)');
        resolve();
      });
      this.server!.once('error', reject);
    });
  }

  stats(): TcpServerStats {
    return {
      listening: !!this.server?.listening,
      host: this.host,
      port: this.port,
      connectedBaseStations: this.sockets.size,
      lastG7MessageAt: this.lastG7MessageAt,
      totalMessages: this.totalMessages,
      parserErrors: this.parserErrors,
      startedAt: this.startedAt,
    };
  }

  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
