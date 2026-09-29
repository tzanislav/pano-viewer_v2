import { randomUUID } from 'node:crypto';
import type { UnderlayUpload } from '@pano/domain';
import { AppError } from '../errors.js';
import { validateUnderlay } from '../jobs/validateUnderlay.js';
import { log } from '../logging.js';
import type { AssetRow } from '../repositories/mediaRepository.js';
import { toUnderlay, UnderlayRepository } from '../repositories/underlayRepository.js';
import type { StorageGateway } from '../storage/StorageGateway.js';
import type { MediaLimits } from './mediaService.js';

export class UnderlayService {
  private readonly inFlight = new Set<string>();
  constructor(private readonly repository: UnderlayRepository, private readonly storage: StorageGateway,
    private readonly limits: MediaLimits & { maxUnderlayBytes: number }) {}

  async reserve(ownerUid: string, tourId: string, pageId: string,
    input: { fileName: string; mimeType: string; byteSize: number }): Promise<{
      upload: UnderlayUpload; uploadUrl: string; expiresIn: number;
    }> {
    if (input.byteSize > this.limits.maxUnderlayBytes) throw new AppError(413, 'UNDERLAY_TOO_LARGE', 'This underlay exceeds the upload limit');
    const id = randomUUID();
    const objectKey = `tours/${tourId}/underlays/${id}`;
    const uploadUrl = await this.storage.signUpload(objectKey, input.mimeType, this.limits.uploadUrlTtlSeconds);
    const asset = this.repository.reserve(ownerUid, tourId, pageId, {
      id, objectKey, fileName: input.fileName, mimeType: input.mimeType, byteSize: input.byteSize
    });
    return { upload: toUnderlay(asset), uploadUrl, expiresIn: this.limits.uploadUrlTtlSeconds };
  }

  async complete(ownerUid: string, tourId: string, pageId: string, assetId: string): Promise<UnderlayUpload> {
    if (this.inFlight.has(assetId)) throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'This underlay is already processing');
    this.inFlight.add(assetId);
    try {
      const asset = this.repository.markProcessing(ownerUid, tourId, pageId, assetId);
      if (asset.status === 'ready') return toUnderlay(asset);
      try {
        const object = await this.storage.head(asset.object_key);
        if (!object) throw new AppError(422, 'UPLOAD_MISSING', 'The uploaded underlay was not found');
        if (object.byteSize !== asset.byte_size || object.byteSize > this.limits.maxUnderlayBytes) {
          throw new AppError(422, 'SIZE_MISMATCH', 'The underlay size does not match the selected file');
        }
        if (object.mimeType !== asset.mime_type) throw new AppError(422, 'TYPE_MISMATCH', 'The underlay type does not match the selected file');
        const bytes = await this.storage.read(asset.object_key);
        if (bytes.length !== object.byteSize) throw new AppError(422, 'SIZE_MISMATCH', 'The underlay upload is incomplete');
        const image = await validateUnderlay(bytes, asset.mime_type);
        const result = this.repository.markReady(ownerUid, tourId, pageId, assetId, image.width, image.height);
        if (result.retired) await this.cleanupOne(result.retired);
        return toUnderlay(result.upload);
      } catch (cause) {
        this.repository.markError(ownerUid, tourId, pageId, assetId, cause instanceof AppError ? cause.code : 'PROCESSING_FAILED');
        if (cause instanceof AppError) throw cause;
        throw new AppError(500, 'PROCESSING_FAILED', 'Could not process this underlay. Try again.');
      }
    } finally { this.inFlight.delete(assetId); }
  }

  async readUrl(ownerUid: string, tourId: string, pageId: string): Promise<{ url: string; expiresIn: number }> {
    const key = this.repository.currentKey(ownerUid, tourId, pageId);
    return { url: await this.storage.signRead(key, this.limits.readUrlTtlSeconds),
      expiresIn: this.limits.readUrlTtlSeconds };
  }

  async cancel(ownerUid: string, tourId: string, pageId: string, assetId: string): Promise<void> {
    if (this.inFlight.has(assetId)) throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'This underlay is processing');
    const asset = this.repository.retireUpload(ownerUid, tourId, pageId, assetId);
    await this.cleanupOne(asset);
  }

  async remove(ownerUid: string, tourId: string, pageId: string, expectedVersion: number): Promise<void> {
    const asset = this.repository.remove(ownerUid, tourId, pageId, expectedVersion);
    await this.cleanupOne(asset);
  }

  private async cleanupOne(asset: Pick<AssetRow, 'id' | 'object_key'>): Promise<void> {
    try {
      await this.storage.delete(asset.object_key);
      this.repository.removeRetired(asset.id);
    } catch { log('warn', 'underlay.cleanup', { outcome: 'failure', assetId: asset.id }); }
  }
}
