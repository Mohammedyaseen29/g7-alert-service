// G7 framing: messages start with "#STA:" and end with a two-hex-digit
// checksum followed by ";#" (for example "E6;#", "9C;#", or "EE;#").
// TCP is a stream: one read may contain partial / multiple / split messages.
export const FRAME_START = '#STA:';
export const FRAME_END_LENGTH = 4;

export function frameEndIndex(value: string): number {
  const match = /;[0-9a-f]{2};#/i.exec(value);
  return match ? match.index + 1 : -1;
}

export function hasFrameEnd(value: string): boolean {
  return /;[0-9a-f]{2};#$/i.test(value);
}

export interface FramerOptions {
  maxMessageBytes: number;
  maxBufferBytes: number;
}

export interface FrameResult {
  frames: string[];
  droppedBytes: number;
  malformedSkipped: number;
}

export class G7StreamBuffer {
  private buf = '';
  malformedSkipped = 0;
  droppedBytes = 0;

  constructor(private opts: FramerOptions) {}

  /** Append a TCP chunk, return complete frames. Never throws on bad data. */
  push(chunk: string | Buffer): string[] {
    this.buf += chunk.toString('utf8');
    if (this.buf.length > this.opts.maxBufferBytes) {
      // Drop oldest bytes to bound memory; count for observability.
      const excess = this.buf.length - this.opts.maxBufferBytes;
      this.buf = this.buf.slice(excess);
      this.droppedBytes += excess;
    }
    const frames: string[] = [];
    for (;;) {
      const start = this.buf.indexOf(FRAME_START);
      if (start === -1) {
        // Keep a tail in case START is split across reads.
        if (this.buf.length > FRAME_START.length) {
          this.malformedSkipped += this.buf.length - FRAME_START.length;
          this.buf = this.buf.slice(-FRAME_START.length);
        }
        break;
      }
      if (start > 0) {
        this.malformedSkipped += start;
        this.buf = this.buf.slice(start);
      }
      const end = frameEndIndex(this.buf);
      if (end === -1) {
        if (this.buf.length > this.opts.maxMessageBytes + FRAME_START.length) {
          // Oversize without terminator: drop up to START+1 and continue.
          this.malformedSkipped += 1;
          this.buf = this.buf.slice(1);
          continue;
        }
        break; // wait for more data
      }
      const frameLen = end + FRAME_END_LENGTH;
      if (frameLen > this.opts.maxMessageBytes) {
        this.malformedSkipped += frameLen;
        this.buf = this.buf.slice(frameLen);
        continue;
      }
      frames.push(this.buf.slice(0, frameLen));
      this.buf = this.buf.slice(frameLen);
    }
    return frames;
  }

  pendingBytes(): number {
    return this.buf.length;
  }
}

