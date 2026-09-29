import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageGateway, StoredObjectInfo } from './StorageGateway.js';

export class S3Storage implements StorageGateway {
  private readonly client: S3Client;

  constructor(private readonly bucket: string, region: string, endpoint?: string, forcePathStyle = false) {
    this.client = new S3Client({ region, endpoint, forcePathStyle, requestChecksumCalculation: 'WHEN_REQUIRED' });
  }

  signUpload(objectKey: string, mimeType: string, expiresIn: number): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.bucket, Key: objectKey, ContentType: mimeType
    }), { expiresIn });
  }

  async head(objectKey: string): Promise<StoredObjectInfo | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      if (result.ContentLength === undefined) throw new Error('S3 object has no content length');
      return { byteSize: result.ContentLength, mimeType: result.ContentType || '' };
    } catch (error) {
      if (typeof error === 'object' && error && '$metadata' in error &&
        (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404) return null;
      throw error;
    }
  }

  async read(objectKey: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    if (!result.Body) throw new Error('S3 object has no body');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async writeThumbnail(objectKey: string, bytes: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: objectKey, Body: bytes, ContentType: 'image/jpeg', CacheControl: 'private, max-age=900'
    }));
  }

  signRead(objectKey: string, expiresIn: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }), { expiresIn });
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }
}
