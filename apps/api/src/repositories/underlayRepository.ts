import type Database from 'better-sqlite3';
import type { UnderlayUpload } from '@pano/domain';
import { AppError } from '../errors.js';
import type { AssetRow } from './mediaRepository.js';

interface UnderlayRow extends AssetRow { underlay_page_id: string; }

export function toUnderlay(row: UnderlayRow): UnderlayUpload {
  return {
    id: row.id, pageId: row.underlay_page_id, fileName: row.original_filename || row.id,
    status: row.status, errorCode: row.error_code, width: row.width, height: row.height
  };
}

export class UnderlayRepository {
  constructor(private readonly db: Database.Database) {}

  private page(ownerUid: string, tourId: string, pageId: string): { plan_asset_id: string | null } {
    const row = this.db.prepare(`SELECT p.plan_asset_id FROM pages p JOIN tours t ON t.id = p.tour_id
      WHERE p.id = ? AND p.tour_id = ? AND t.owner_uid = ?`).get(pageId, tourId, ownerUid) as
      { plan_asset_id: string | null } | undefined;
    if (!row) throw new AppError(404, 'PAGE_NOT_FOUND', 'Page not found');
    return row;
  }

  list(ownerUid: string, tourId: string): UnderlayUpload[] {
    const owner = this.db.prepare('SELECT id FROM tours WHERE id = ? AND owner_uid = ?').get(tourId, ownerUid);
    if (!owner) throw new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found');
    return (this.db.prepare(`SELECT m.* FROM media_assets m JOIN pages p ON p.id = m.underlay_page_id
      WHERE m.tour_id = ? AND m.kind = 'plan' AND m.retired_at IS NULL ORDER BY m.created_at`)
      .all(tourId) as UnderlayRow[]).map(toUnderlay);
  }

  reserve(ownerUid: string, tourId: string, pageId: string, input: {
    id: string; objectKey: string; fileName: string; mimeType: string; byteSize: number;
  }): UnderlayRow {
    this.db.transaction(() => {
      this.page(ownerUid, tourId, pageId);
      const pending = this.db.prepare(`SELECT id FROM media_assets WHERE tour_id = ? AND underlay_page_id = ?
        AND status IN ('uploading', 'processing') AND retired_at IS NULL`).get(tourId, pageId);
      if (pending) throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'An underlay upload is already in progress for this page');
      const now = new Date().toISOString();
      this.db.prepare(`UPDATE media_assets SET retired_at = ?, updated_at = ? WHERE tour_id = ? AND underlay_page_id = ?
        AND status = 'error' AND retired_at IS NULL`).run(now, now, tourId, pageId);
      this.db.prepare(`INSERT INTO media_assets (id, tour_id, kind, object_key, original_filename,
        underlay_page_id, mime_type, byte_size, status, created_at, updated_at)
        VALUES (?, ?, 'plan', ?, ?, ?, ?, ?, 'uploading', ?, ?)`).run(
        input.id, tourId, input.objectKey, input.fileName, pageId, input.mimeType, input.byteSize, now, now
      );
    })();
    return this.get(ownerUid, tourId, pageId, input.id);
  }

  get(ownerUid: string, tourId: string, pageId: string, assetId: string): UnderlayRow {
    this.page(ownerUid, tourId, pageId);
    const row = this.db.prepare(`SELECT * FROM media_assets WHERE id = ? AND tour_id = ? AND kind = 'plan'
      AND underlay_page_id = ? AND retired_at IS NULL`).get(assetId, tourId, pageId) as UnderlayRow | undefined;
    if (!row) throw new AppError(404, 'UNDERLAY_NOT_FOUND', 'Underlay upload not found');
    return row;
  }

  markProcessing(ownerUid: string, tourId: string, pageId: string, assetId: string): UnderlayRow {
    const asset = this.get(ownerUid, tourId, pageId, assetId);
    if (asset.status !== 'ready') {
      this.db.prepare(`UPDATE media_assets SET status = 'processing', error_code = NULL, updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), assetId);
    }
    return this.get(ownerUid, tourId, pageId, assetId);
  }

  markError(ownerUid: string, tourId: string, pageId: string, assetId: string, code: string): void {
    this.get(ownerUid, tourId, pageId, assetId);
    this.db.prepare(`UPDATE media_assets SET status = 'error', error_code = ?, updated_at = ?
      WHERE id = ? AND status <> 'ready'`).run(code, new Date().toISOString(), assetId);
  }

  markReady(ownerUid: string, tourId: string, pageId: string, assetId: string,
    width: number, height: number): { upload: UnderlayRow; retired: AssetRow | null } {
    let retired: AssetRow | null = null;
    this.db.transaction(() => {
      const page = this.page(ownerUid, tourId, pageId);
      const asset = this.get(ownerUid, tourId, pageId, assetId);
      if (asset.status !== 'processing') throw new AppError(409, 'UPLOAD_STATE', 'Underlay is not processing');
      const now = new Date().toISOString();
      if (page.plan_asset_id) {
        retired = this.db.prepare('SELECT * FROM media_assets WHERE id = ?').get(page.plan_asset_id) as AssetRow;
      }
      this.db.prepare(`UPDATE media_assets SET status = 'ready', width = ?, height = ?, error_code = NULL,
        updated_at = ? WHERE id = ?`).run(width, height, now, assetId);
      this.db.prepare('UPDATE pages SET plan_asset_id = ? WHERE id = ? AND tour_id = ?').run(assetId, pageId, tourId);
      if (retired) this.db.prepare('UPDATE media_assets SET retired_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, (retired as AssetRow).id);
      this.db.prepare('UPDATE tours SET version = version + 1, updated_at = ? WHERE id = ?').run(now, tourId);
    })();
    return { upload: this.get(ownerUid, tourId, pageId, assetId), retired };
  }

  retireUpload(ownerUid: string, tourId: string, pageId: string, assetId: string): UnderlayRow {
    const asset = this.get(ownerUid, tourId, pageId, assetId);
    if (asset.status === 'ready') throw new AppError(409, 'UNDERLAY_READY', 'A ready underlay cannot be canceled');
    const now = new Date().toISOString();
    this.db.prepare('UPDATE media_assets SET retired_at = ?, updated_at = ? WHERE id = ?').run(now, now, assetId);
    return asset;
  }

  currentKey(ownerUid: string, tourId: string, pageId: string): string {
    const page = this.page(ownerUid, tourId, pageId);
    if (!page.plan_asset_id) throw new AppError(404, 'UNDERLAY_NOT_FOUND', 'This page has no underlay');
    const asset = this.get(ownerUid, tourId, pageId, page.plan_asset_id);
    if (asset.status !== 'ready') throw new AppError(404, 'UNDERLAY_NOT_FOUND', 'Underlay is not ready');
    return asset.object_key;
  }

  remove(ownerUid: string, tourId: string, pageId: string, expectedVersion: number): AssetRow {
    let retired: AssetRow | null = null;
    this.db.transaction(() => {
      const page = this.page(ownerUid, tourId, pageId);
      const tour = this.db.prepare('SELECT version FROM tours WHERE id = ? AND owner_uid = ?')
        .get(tourId, ownerUid) as { version: number };
      if (tour.version !== expectedVersion) throw new AppError(409, 'VERSION_CONFLICT', 'This tour changed. Reload it and try again.');
      if (!page.plan_asset_id) throw new AppError(404, 'UNDERLAY_NOT_FOUND', 'This page has no underlay');
      retired = this.db.prepare('SELECT * FROM media_assets WHERE id = ?').get(page.plan_asset_id) as AssetRow;
      const now = new Date().toISOString();
      this.db.prepare('UPDATE pages SET plan_asset_id = NULL WHERE id = ? AND tour_id = ?').run(pageId, tourId);
      this.db.prepare('UPDATE media_assets SET retired_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, page.plan_asset_id);
      this.db.prepare(`UPDATE media_assets SET retired_at = ?, updated_at = ? WHERE tour_id = ?
        AND underlay_page_id = ? AND retired_at IS NULL`).run(now, now, tourId, pageId);
      this.db.prepare('UPDATE tours SET version = version + 1, updated_at = ? WHERE id = ?').run(now, tourId);
    })();
    return retired!;
  }

  removeRetired(assetId: string): void {
    this.db.prepare('DELETE FROM media_assets WHERE id = ? AND retired_at IS NOT NULL').run(assetId);
  }
}
