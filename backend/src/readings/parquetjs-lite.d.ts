declare module 'parquetjs-lite' {
  export class ParquetSchema {
    constructor(fields: Record<string, { type: string; optional?: boolean; compression?: string }>);
  }
  export class ParquetWriter {
    static openFile(schema: ParquetSchema, path: string): Promise<ParquetWriter>;
    setRowGroupSize(size: number): void;
    appendRow(row: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
  }
  export class ParquetReader {
    static openFile(path: string): Promise<ParquetReader>;
    static openBuffer(buffer: Buffer): Promise<ParquetReader>;
    getCursor(columns?: string[]): { next(): Promise<Record<string, unknown> | null> };
    close(): Promise<void>;
  }
}
