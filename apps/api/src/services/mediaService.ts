import { randomUUID } from 'node:crypto';
import { photoNameKey, photoNameStem, type PanoramaAsset } from '@pano/domain';
import { AppError } from '../errors.js';
import { validatePanorama } from '../jobs/validatePanorama.js';
import { log } from '../logging.js';
import { MediaRepository, toPanoramaAsset } from '../repositories/mediaRepository.js';
import type { StorageGateway } from '../storage/StorageGateway.js';

export interface MediaLimits {
  maxPanoramaBytes: number;
  uploadUrlTtlSeconds: number;
  readUrlTtlSeconds: number;
}

export class MediaService {
  private readonly inFlight = new Set<string>();
  constructor(private readonly repository: MediaRepository,
    private readonly storage: StorageGateway, private readonly limits: MediaLimits) {}

  get readUrlTtlSeconds(): number { return this.limits.readUrlTtlSeconds; }

  async reserve(ownerUid: string, tourId: string, input: {
    fileName: string; mimeType: string; byteSize: number;
  }): Promise<{ asset: PanoramaAsset; uploadUrl: string; expiresIn: number }> {
    this.repository.assertOwner(ownerUid, tourId);
    if (input.byteSize > this.limits.maxPanoramaBytes) {
      throw new AppError(413, 'PHOTO_TOO_LARGE', 'This photo exceeds the upload size limit');
    }
    let filenameKey: string;
    try { filenameKey = photoNameKey(input.fileName); }
    catch { throw new AppError(400, 'INVALID_FILENAME', 'Choose a photo with a valid filename'); }
    const id = randomUUID();
    const objectKey = `tours/${tourId}/panoramas/${id}`;
    const uploadUrl = await this.storage.signUpload(objectKey, input.mimeType, this.limits.uploadUrlTtlSeconds);
    const asset = this.repository.reserve(ownerUid, tourId, {
      id, objectKey, fileName: input.fileName.trim(), filenameKey,
      mimeType: input.mimeType, byteSize: input.byteSize
    });
    await this.cleanupRetired();
    return { asset: toPanoramaAsset(asset), uploadUrl, expiresIn: this.limits.uploadUrlTtlSeconds };
  }

  async complete(ownerUid: string, tourId: string, assetId: string): Promise<{ asset: PanoramaAsset; sceneId: string | null }> {
    if (this.inFlight.has(assetId)) throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'This photo is already processing');
    this.inFlight.add(assetId);
    try { return await this.processUpload(ownerUid, tourId, assetId); }
    finally { this.inFlight.delete(assetId); }
  }

  private async processUpload(ownerUid: string, tourId: string, assetId: string): Promise<{ asset: PanoramaAsset; sceneId: string | null }> {
    const asset = this.repository.markProcessing(ownerUid, tourId, assetId);
    if (asset.status === 'ready') return { asset: toPanoramaAsset(asset), sceneId: null };
    try {
      const object = await this.storage.head(asset.object_key);
      if (!object) throw new AppError(422, 'UPLOAD_MISSING', 'The uploaded photo was not found');
      if (object.byteSize !== asset.byte_size || object.byteSize > this.limits.maxPanoramaBytes) {
        throw new AppError(422, 'SIZE_MISMATCH', 'The uploaded photo size does not match the selected file');
      }
      if (object.mimeType !== asset.mime_type) {
        throw new AppError(422, 'TYPE_MISMATCH', 'The uploaded photo type does not match the selected file');
      }
      const bytes = await this.storage.read(asset.object_key);
      if (bytes.length !== object.byteSize) throw new AppError(422, 'SIZE_MISMATCH', 'The uploaded photo is incomplete');
      const image = await validatePanorama(bytes, asset.mime_type);
      const thumbnailKey = `tours/${tourId}/thumbnails/${assetId}.jpg`;
      await this.storage.writeThumbnail(thumbnailKey, image.thumbnail);
      const result = this.repository.markReady(ownerUid, tourId, assetId,
        thumbnailKey, image.width, image.height, photoNameStem(asset.original_filename || asset.id));
      if (result.retired) await this.cleanupOne(result.retired);
      return { asset: toPanoramaAsset(result.asset), sceneId: result.sceneId };
    } catch (cause) {
      const code = cause instanceof AppError ? cause.code : 'PROCESSING_FAILED';
      this.repository.markError(ownerUid, tourId, assetId, code);
      if (cause instanceof AppError) throw cause;
      throw new AppError(500, code, 'Could not process this photo. Retry or select it again.');
    }
  }

  async thumbnailUrl(ownerUid: string, tourId: string, assetId: string): Promise<{ url: string; expiresIn: number }> {
    const key = this.repository.thumbnailKey(ownerUid, tourId, assetId);
    const url = await this.storage.signRead(key, this.limits.readUrlTtlSeconds);
    return { url, expiresIn: this.limits.readUrlTtlSeconds };
  }

  async cancel(ownerUid: string, tourId: string, assetId: string): Promise<void> {
    if (this.inFlight.has(assetId)) throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'This photo is processing');
    const retired = this.repository.retireUpload(ownerUid, tourId, assetId);
    await this.cleanupOne(retired);
  }

  async originalUrl(ownerUid: string, tourId: string, assetId: string): Promise<{ url: string; expiresIn: number }> {
    const key = this.repository.originalKey(ownerUid, tourId, assetId);
    const url = await this.storage.signRead(key, this.limits.readUrlTtlSeconds);
    return { url, expiresIn: this.limits.readUrlTtlSeconds };
  }

  async cleanupRetired(): Promise<void> {
    for (const asset of this.repository.retiredAssets()) await this.cleanupOne(asset);
  }

  async deleteObjects(keys: readonly string[]): Promise<void> {
    for (const key of keys) await this.storage.delete(key);
  }

  private async cleanupOne(asset: { id: string; object_key: string; thumbnail_key: string | null }): Promise<void> {
    try {
      await this.storage.delete(asset.object_key);
      if (asset.thumbnail_key) await this.storage.delete(asset.thumbnail_key);
      this.repository.removeRetired(asset.id);
    } catch {
      log('warn', 'asset.cleanup', { outcome: 'failure', assetId: asset.id });
    }
  }
}
