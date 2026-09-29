import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { PanoramaAsset } from '@pano/domain';
import { AppError } from '../errors.js';

export interface AssetRow {
  id: string;
  tour_id: string;
  kind: 'panorama' | 'plan';
  object_key: string;
  thumbnail_key: string | null;
  original_filename: string | null;
  filename_key: string | null;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  error_code: string | null;
  replaces_scene_id: string | null;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toPanoramaAsset(row: AssetRow): PanoramaAsset {
  return {
    id: row.id, tourId: row.tour_id, fileName: row.original_filename || row.id,
    filenameKey: row.filename_key || row.id, mimeType: row.mime_type, byteSize: row.byte_size,
    width: row.width, height: row.height, status: row.status, errorCode: row.error_code,
    thumbnailReady: Boolean(row.thumbnail_key), replacesSceneId: row.replaces_scene_id,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export class MediaRepository {
  constructor(private readonly db: Database.Database) {}

  assertOwner(ownerUid: string, tourId: string): void {
    const row = this.db.prepare('SELECT id FROM tours WHERE id = ? AND owner_uid = ?').get(tourId, ownerUid);
    if (!row) throw new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found');
  }

  list(ownerUid: string, tourId: string): PanoramaAsset[] {
    this.assertOwner(ownerUid, tourId);
    const rows = this.db.prepare(`SELECT * FROM media_assets WHERE tour_id = ? AND kind = 'panorama'
      AND retired_at IS NULL ORDER BY created_at, id`).all(tourId) as AssetRow[];
    return rows.map(toPanoramaAsset);
  }

  reserve(ownerUid: string, tourId: string, input: {
    id: string; objectKey: string; fileName: string; filenameKey: string; mimeType: string; byteSize: number;
  }): AssetRow {
    this.db.transaction(() => {
      this.assertOwner(ownerUid, tourId);
      const pending = this.db.prepare(`SELECT id FROM media_assets WHERE tour_id = ? AND filename_key = ?
        AND status IN ('uploading', 'processing') AND retired_at IS NULL`).get(tourId, input.filenameKey);
      if (pending) throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'An upload with this photo name is already in progress');
      this.db.prepare(`UPDATE media_assets SET retired_at = ? WHERE tour_id = ? AND filename_key = ?
        AND status = 'error' AND retired_at IS NULL`).run(new Date().toISOString(), tourId, input.filenameKey);
      const current = this.db.prepare(`SELECT s.id FROM scenes s JOIN media_assets m ON m.id = s.panorama_asset_id
        WHERE s.tour_id = ? AND m.filename_key = ?`).get(tourId, input.filenameKey) as { id: string } | undefined;
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO media_assets
        (id, tour_id, kind, object_key, original_filename, filename_key, mime_type, byte_size,
         status, replaces_scene_id, created_at, updated_at)
        VALUES (?, ?, 'panorama', ?, ?, ?, ?, ?, 'uploading', ?, ?, ?)`).run(
        input.id, tourId, input.objectKey, input.fileName, input.filenameKey,
        input.mimeType, input.byteSize, current?.id || null, now, now
      );
    })();
    return this.get(ownerUid, tourId, input.id);
  }

  get(ownerUid: string, tourId: string, assetId: string): AssetRow {
    this.assertOwner(ownerUid, tourId);
    const row = this.db.prepare('SELECT * FROM media_assets WHERE id = ? AND tour_id = ? AND retired_at IS NULL')
      .get(assetId, tourId) as AssetRow | undefined;
    if (!row) throw new AppError(404, 'ASSET_NOT_FOUND', 'Photo upload not found');
    return row;
  }

  markProcessing(ownerUid: string, tourId: string, assetId: string): AssetRow {
    this.db.transaction(() => {
      const asset = this.get(ownerUid, tourId, assetId);
      if (asset.status === 'ready') return;
      const otherPending = this.db.prepare(`SELECT id FROM media_assets WHERE tour_id = ? AND filename_key = ?
        AND id <> ? AND status IN ('uploading', 'processing') AND retired_at IS NULL`)
        .get(tourId, asset.filename_key, assetId);
      if (otherPending) throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'A newer upload with this name is in progress');
      this.db.prepare(`UPDATE media_assets SET status = 'processing', error_code = NULL, updated_at = ?
        WHERE id = ?`).run(new Date().toISOString(), assetId);
    })();
    return this.get(ownerUid, tourId, assetId);
  }

  markError(ownerUid: string, tourId: string, assetId: string, code: string): void {
    this.db.transaction(() => {
      this.get(ownerUid, tourId, assetId);
      this.db.prepare(`UPDATE media_assets SET status = 'error', error_code = ?, updated_at = ?
        WHERE id = ? AND status <> 'ready'`)
        .run(code, new Date().toISOString(), assetId);
    })();
  }

  retireUpload(ownerUid: string, tourId: string, assetId: string): AssetRow {
    const asset = this.get(ownerUid, tourId, assetId);
    if (asset.status === 'ready') throw new AppError(409, 'PHOTO_READY', 'A ready photo cannot be canceled');
    this.db.prepare('UPDATE media_assets SET retired_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), assetId);
    return asset;
  }

  markReady(ownerUid: string, tourId: string, assetId: string, thumbnailKey: string,
    width: number, height: number, sceneName: string): { asset: AssetRow; sceneId: string; retired: AssetRow | null } {
    let sceneId = '';
    let retired: AssetRow | null = null;
    this.db.transaction(() => {
      const asset = this.get(ownerUid, tourId, assetId);
      if (asset.status !== 'processing') throw new AppError(409, 'UPLOAD_STATE', 'Photo is not processing');
      const current = this.db.prepare(`SELECT s.id, s.panorama_asset_id FROM scenes s
        JOIN media_assets m ON m.id = s.panorama_asset_id
        WHERE s.tour_id = ? AND m.filename_key = ?`).get(tourId, asset.filename_key) as
        { id: string; panorama_asset_id: string } | undefined;
      const now = new Date().toISOString();
      this.db.prepare(`UPDATE media_assets SET status = 'ready', thumbnail_key = ?, width = ?, height = ?,
        error_code = NULL, updated_at = ? WHERE id = ?`).run(thumbnailKey, width, height, now, assetId);
      if (current) {
        sceneId = current.id;
        retired = this.db.prepare('SELECT * FROM media_assets WHERE id = ?').get(current.panorama_asset_id) as AssetRow;
        this.db.prepare('UPDATE scenes SET panorama_asset_id = ? WHERE id = ? AND tour_id = ?')
          .run(assetId, sceneId, tourId);
        this.db.prepare('UPDATE media_assets SET retired_at = ?, updated_at = ? WHERE id = ?')
          .run(now, now, current.panorama_asset_id);
      } else {
        sceneId = randomUUID();
        const order = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM scenes WHERE tour_id = ?')
          .get(tourId) as { next_order: number };
        this.db.prepare(`INSERT INTO scenes (id, tour_id, panorama_asset_id, name, sort_order)
          VALUES (?, ?, ?, ?, ?)`).run(sceneId, tourId, assetId, sceneName, order.next_order);
      }
      this.db.prepare('UPDATE tours SET version = version + 1, updated_at = ? WHERE id = ?').run(now, tourId);
    })();
    return { asset: this.get(ownerUid, tourId, assetId), sceneId, retired };
  }

  thumbnailKey(ownerUid: string, tourId: string, assetId: string): string {
    const asset = this.get(ownerUid, tourId, assetId);
    if (asset.status !== 'ready' || !asset.thumbnail_key) throw new AppError(404, 'THUMBNAIL_NOT_FOUND', 'Thumbnail not ready');
    const inUse = this.db.prepare('SELECT id FROM scenes WHERE tour_id = ? AND panorama_asset_id = ?').get(tourId, assetId);
    if (!inUse) throw new AppError(404, 'THUMBNAIL_NOT_FOUND', 'Thumbnail not found');
    return asset.thumbnail_key;
  }

  originalKey(ownerUid: string, tourId: string, assetId: string): string {
    const asset = this.get(ownerUid, tourId, assetId);
    if (asset.status !== 'ready') throw new AppError(404, 'PHOTO_NOT_READY', 'Photo is not ready');
    const inUse = this.db.prepare('SELECT id FROM scenes WHERE tour_id = ? AND panorama_asset_id = ?').get(tourId, assetId);
    if (!inUse) throw new AppError(404, 'PHOTO_NOT_FOUND', 'Photo not found');
    return asset.object_key;
  }

  retiredAssets(): AssetRow[] {
    return this.db.prepare('SELECT * FROM media_assets WHERE retired_at IS NOT NULL ORDER BY retired_at LIMIT 50').all() as AssetRow[];
  }

  removeRetired(assetId: string): void {
    this.db.prepare('DELETE FROM media_assets WHERE id = ? AND retired_at IS NOT NULL').run(assetId);
  }
}
