import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config/config.js';

export class OracleObjects {
  readonly enabled: boolean;
  private client: S3Client | null = null;
  private bucket: string;

  constructor(config: AppConfig) {
    const values = [config.OCI_OBJECT_NAMESPACE, config.OCI_OBJECT_REGION, config.OCI_OBJECT_BUCKET, config.OCI_OBJECT_ACCESS_KEY, config.OCI_OBJECT_SECRET_KEY];
    this.enabled = values.every(Boolean);
    if (values.some(Boolean) && !this.enabled) throw new Error('All five OCI_OBJECT_* settings must be set together');
    this.bucket = config.OCI_OBJECT_BUCKET;
    if (this.enabled) {
      this.client = new S3Client({
        region: config.OCI_OBJECT_REGION,
        endpoint: `https://${config.OCI_OBJECT_NAMESPACE}.compat.objectstorage.${config.OCI_OBJECT_REGION}.oraclecloud.com`,
        forcePathStyle: true,
        credentials: { accessKeyId: config.OCI_OBJECT_ACCESS_KEY, secretAccessKey: config.OCI_OBJECT_SECRET_KEY },
      });
    }
  }

  private get ready(): S3Client {
    if (!this.client) throw new Error('Oracle Object Storage is not configured');
    return this.client;
  }

  async uploadFile(key: string, path: string, contentType: string): Promise<number> {
    const size = (await stat(path)).size;
    const upload = new Upload({
      client: this.ready,
      params: { Bucket: this.bucket, Key: key, Body: createReadStream(path), ContentType: contentType },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    await upload.done();
    const head = await this.ready.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    if (head.ContentLength !== size) throw new Error(`Oracle archive size mismatch for ${key}`);
    return size;
  }

  async uploadStream(key: string, body: Readable, contentType: string): Promise<void> {
    const upload = new Upload({
      client: this.ready,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    await upload.done();
  }

  async putBytes(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ready.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async *listKeys(prefix: string): AsyncGenerator<string> {
    let cursor: string | undefined;
    do {
      const page = await this.ready.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: cursor }));
      for (const item of page.Contents ?? []) if (item.Key) yield item.Key;
      cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !cursor) throw new Error('Oracle object listing stopped before all pages were returned');
    } while (cursor);
  }

  async downloadFile(key: string, path: string): Promise<void> {
    await pipeline(await this.readStream(key), createWriteStream(path));
  }

  async readStream(key: string): Promise<Readable> {
    const result = await this.ready.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error(`Oracle returned an empty body for ${key}`);
    return result.Body as Readable;
  }

  async signedDownload(key: string, filename: string): Promise<string> {
    return getSignedUrl(this.ready, new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
    }), { expiresIn: 300 });
  }

  async delete(key: string): Promise<void> {
    await this.ready.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
