import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileHandle } from 'node:fs/promises';

export interface SpoolFrame {
  packetId: string;
  receivedAt: string;
  raw: string;
}

/** Append-only, fsynced local write-ahead log for frames received over TCP. */
export class IngestSpool {
  private checkpoint = 0;
  private size = 0;
  private chain: Promise<void> = Promise.resolve();

  private constructor(private handle: FileHandle, private file: string, private checkpointFile: string, private maxBytes: number) {}

  static async open(directory: string, maxBytes: number): Promise<IngestSpool> {
    await mkdir(directory, { recursive: true });
    const file = join(directory, 'sensor-ingest.ndjson');
    const checkpointFile = join(directory, 'sensor-ingest.checkpoint');
    const handle = await open(file, 'a+');
    const spool = new IngestSpool(handle, file, checkpointFile, maxBytes);
    spool.size = (await handle.stat()).size;
    const recorded = Number((await readFile(checkpointFile, 'utf8').catch(() => '0')).trim());
    spool.checkpoint = Number.isSafeInteger(recorded) && recorded >= 0 && recorded <= spool.size ? recorded : 0;
    return spool;
  }

  get pendingBytes(): number { return this.size - this.checkpoint; }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(work);
    this.chain = result.then(() => {}, () => {});
    return result;
  }

  async accept(raw: string, process: (frame: SpoolFrame) => Promise<void>): Promise<void> {
    return this.exclusive(async () => {
      const frame: SpoolFrame = { packetId: randomUUID(), receivedAt: new Date().toISOString(), raw };
      const bytes = Buffer.from(JSON.stringify(frame) + '\n');
      if (this.pendingBytes + bytes.length > this.maxBytes) throw new Error('Sensor ingest spool is full');
      // FileHandle.write may complete with fewer bytes than requested. Never
      // acknowledge a frame until the entire record has reached the spool.
      try {
        let written = 0;
        while (written < bytes.length) {
          const result = await this.handle.write(bytes, written, bytes.length - written);
          if (result.bytesWritten === 0) throw new Error('Sensor ingest spool write made no progress');
          written += result.bytesWritten;
        }
      } catch (error) {
        await this.handle.truncate(this.size);
        await this.handle.sync();
        throw error;
      }
      await this.handle.sync();
      this.size += bytes.length;
      await this.drain(process);
    });
  }

  async replay(process: (frame: SpoolFrame) => Promise<void>): Promise<void> {
    return this.exclusive(() => this.drain(process));
  }

  private async saveCheckpoint(offset: number): Promise<void> {
    const temp = `${this.checkpointFile}.tmp`;
    const handle = await open(temp, 'w');
    try { await handle.writeFile(String(offset)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, this.checkpointFile);
    this.checkpoint = offset;
  }

  private async drain(process: (frame: SpoolFrame) => Promise<void>): Promise<void> {
    if (this.checkpoint >= this.size) return;
    let offset = this.checkpoint;
    let pending = Buffer.alloc(0);
    const stream = createReadStream(this.file, { start: offset, end: this.size - 1 });
    for await (const chunk of stream) {
      pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      for (;;) {
        const newline = pending.indexOf(10);
        if (newline < 0) break;
        const line = pending.subarray(0, newline);
        const frame = JSON.parse(line.toString('utf8')) as SpoolFrame;
        if (!frame.packetId || !frame.receivedAt || !frame.raw) throw new Error('Corrupt sensor ingest spool frame');
        await process(frame);
        offset += newline + 1;
        await this.saveCheckpoint(offset);
        pending = pending.subarray(newline + 1);
      }
    }
    // A partial final record can only come from a crash during append. It was
    // never fsynced as a complete frame and must not be interpreted as data.
    if (pending.length) {
      await this.handle.truncate(offset);
      await this.handle.sync();
      this.size = offset;
    }
    if (this.checkpoint === this.size && this.size >= 16 * 1024 * 1024) {
      await this.handle.truncate(0);
      await this.handle.sync();
      this.size = 0;
      await this.saveCheckpoint(0);
    }
  }

  async close(): Promise<void> {
    await this.chain;
    await this.handle.close();
  }
}
