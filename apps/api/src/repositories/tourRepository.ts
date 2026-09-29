import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { NavigationLink, Page, Placement, PlanConnection, Scene, Tour, TourEditorData } from '@pano/domain';
import { AppError } from '../errors.js';
import { MediaRepository } from './mediaRepository.js';

interface TourRow {
  id: string;
  owner_uid: string;
  title: string;
  entry_scene_id: string | null;
  default_north_yaw_deg: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface PageRow {
  id: string;
  tour_id: string;
  name: string;
  sort_order: number;
  north_angle_deg: number;
  plan_asset_id: string | null;
}

interface SceneRow {
  id: string; tour_id: string; panorama_asset_id: string; name: string;
  sort_order: number; north_yaw_override_deg: number | null;
}
interface PlacementRow {
  id: string; tour_id: string; page_id: string; scene_id: string; x: number; y: number;
}
interface ConnectionRow {
  id: string; tour_id: string; placement_a_id: string; placement_b_id: string;
}
interface LinkRow {
  id: string; tour_id: string; source_scene_id: string; target_scene_id: string;
  plan_connection_id: string | null; position_mode: 'auto' | 'manual';
  manual_yaw_deg: number | null; manual_pitch_deg: number | null;
}

const toTour = (row: TourRow): Tour => ({
  id: row.id, title: row.title, entrySceneId: row.entry_scene_id,
  defaultNorthYawDeg: row.default_north_yaw_deg, version: row.version,
  createdAt: row.created_at, updatedAt: row.updated_at
});
const toPage = (row: PageRow): Page => ({
  id: row.id, tourId: row.tour_id, name: row.name, sortOrder: row.sort_order,
  northAngleDeg: row.north_angle_deg, planAssetId: row.plan_asset_id
});
const toScene = (row: SceneRow): Scene => ({
  id: row.id, tourId: row.tour_id, panoramaAssetId: row.panorama_asset_id,
  name: row.name, sortOrder: row.sort_order, northYawOverrideDeg: row.north_yaw_override_deg
});
const toPlacement = (row: PlacementRow): Placement => ({
  id: row.id, tourId: row.tour_id, pageId: row.page_id, sceneId: row.scene_id, x: row.x, y: row.y
});
const toConnection = (row: ConnectionRow): PlanConnection => ({
  id: row.id, tourId: row.tour_id, placementAId: row.placement_a_id, placementBId: row.placement_b_id
});
const toLink = (row: LinkRow): NavigationLink => ({
  id: row.id, tourId: row.tour_id, sourceSceneId: row.source_scene_id, targetSceneId: row.target_scene_id,
  planConnectionId: row.plan_connection_id, positionMode: row.position_mode,
  manualYawDeg: row.manual_yaw_deg, manualPitchDeg: row.manual_pitch_deg
});

export class TourRepository {
  constructor(private readonly db: Database.Database) {}

  list(ownerUid: string): Tour[] {
    const rows = this.db.prepare('SELECT * FROM tours WHERE owner_uid = ? ORDER BY updated_at DESC').all(ownerUid) as TourRow[];
    return rows.map(toTour);
  }

  create(ownerUid: string, title: string): TourEditorData {
    const id = randomUUID();
    const pageId = randomUUID();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO tours (id, owner_uid, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, ownerUid, title, now, now);
      this.db.prepare('INSERT INTO pages (id, tour_id, name, sort_order) VALUES (?, ?, ?, 0)')
        .run(pageId, id, 'Ground floor');
    })();
    return this.get(ownerUid, id);
  }

  get(ownerUid: string, id: string): TourEditorData {
    const tour = this.requireOwner(ownerUid, id);
    const pages = (this.db.prepare('SELECT * FROM pages WHERE tour_id = ? ORDER BY sort_order, id').all(id) as PageRow[]).map(toPage);
    const scenes = (this.db.prepare('SELECT * FROM scenes WHERE tour_id = ? ORDER BY sort_order, id').all(id) as SceneRow[]).map(toScene);
    const placements = (this.db.prepare('SELECT * FROM placements WHERE tour_id = ?').all(id) as PlacementRow[]).map(toPlacement);
    const connections = (this.db.prepare('SELECT * FROM plan_connections WHERE tour_id = ?').all(id) as ConnectionRow[]).map(toConnection);
    const links = (this.db.prepare('SELECT * FROM navigation_links WHERE tour_id = ?').all(id) as LinkRow[]).map(toLink);
    const assets = new MediaRepository(this.db).list(ownerUid, id);
    return { tour: toTour(tour), pages, scenes, placements, connections, links, assets };
  }

  updateTour(ownerUid: string, id: string, input: {
    expectedVersion: number; title?: string; defaultNorthYawDeg?: number; entrySceneId?: string | null;
  }): TourEditorData {
    this.db.transaction(() => {
      const current = this.requireVersion(ownerUid, id, input.expectedVersion);
      if (input.entrySceneId) {
        const scene = this.db.prepare('SELECT id FROM scenes WHERE id = ? AND tour_id = ?').get(input.entrySceneId, id);
        if (!scene) throw new AppError(422, 'INVALID_ENTRY_SCENE', 'Entry scene must belong to this tour');
      }
      this.db.prepare(`UPDATE tours SET title = ?, default_north_yaw_deg = ?, entry_scene_id = ?,
        version = version + 1, updated_at = ? WHERE id = ?`)
        .run(input.title ?? current.title,
          input.defaultNorthYawDeg ?? current.default_north_yaw_deg,
          input.entrySceneId === undefined ? current.entry_scene_id : input.entrySceneId,
          new Date().toISOString(), id);
    })();
    return this.get(ownerUid, id);
  }

  createPage(ownerUid: string, tourId: string, name: string, expectedVersion: number): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, expectedVersion);
      const order = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM pages WHERE tour_id = ?')
        .get(tourId) as { next_order: number };
      this.db.prepare('INSERT INTO pages (id, tour_id, name, sort_order) VALUES (?, ?, ?, ?)')
        .run(randomUUID(), tourId, name, order.next_order);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  updatePage(ownerUid: string, tourId: string, pageId: string, input: {
    expectedVersion: number; name?: string; northAngleDeg?: number;
  }): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, input.expectedVersion);
      const page = this.db.prepare('SELECT * FROM pages WHERE id = ? AND tour_id = ?').get(pageId, tourId) as PageRow | undefined;
      if (!page) throw new AppError(404, 'PAGE_NOT_FOUND', 'Page not found');
      this.db.prepare('UPDATE pages SET name = ?, north_angle_deg = ? WHERE id = ?')
        .run(input.name ?? page.name,
          input.northAngleDeg ?? page.north_angle_deg, pageId);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  deletePage(ownerUid: string, tourId: string, pageId: string, expectedVersion: number): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, expectedVersion);
      const page = this.db.prepare('SELECT id FROM pages WHERE id = ? AND tour_id = ?').get(pageId, tourId);
      if (!page) throw new AppError(404, 'PAGE_NOT_FOUND', 'Page not found');
      const pageCount = this.db.prepare('SELECT COUNT(*) AS count FROM pages WHERE tour_id = ?').get(tourId) as { count: number };
      if (pageCount.count <= 1) throw new AppError(409, 'LAST_PAGE', 'A tour must keep at least one page');

      // Remove only plan-owned links. Viewer-created links between these scenes survive.
      this.db.prepare(`DELETE FROM navigation_links WHERE tour_id = ? AND plan_connection_id IN (
        SELECT c.id FROM plan_connections c
        JOIN placements a ON a.id = c.placement_a_id
        JOIN placements b ON b.id = c.placement_b_id
        WHERE c.tour_id = ? AND (a.page_id = ? OR b.page_id = ?)
      )`).run(tourId, tourId, pageId, pageId);
      this.db.prepare(`DELETE FROM plan_connections WHERE tour_id = ? AND id IN (
        SELECT c.id FROM plan_connections c
        JOIN placements a ON a.id = c.placement_a_id
        JOIN placements b ON b.id = c.placement_b_id
        WHERE c.tour_id = ? AND (a.page_id = ? OR b.page_id = ?)
      )`).run(tourId, tourId, pageId, pageId);
      this.db.prepare('DELETE FROM placements WHERE tour_id = ? AND page_id = ?').run(tourId, pageId);
      this.db.prepare('DELETE FROM pages WHERE tour_id = ? AND id = ?').run(tourId, pageId);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  private requireOwner(ownerUid: string, tourId: string): TourRow {
    const row = this.db.prepare('SELECT * FROM tours WHERE id = ? AND owner_uid = ?').get(tourId, ownerUid) as TourRow | undefined;
    if (!row) throw new AppError(404, 'TOUR_NOT_FOUND', 'Tour not found');
    return row;
  }

  private requireVersion(ownerUid: string, tourId: string, expectedVersion: number): TourRow {
    const row = this.requireOwner(ownerUid, tourId);
    if (row.version !== expectedVersion) throw new AppError(409, 'VERSION_CONFLICT', 'This tour changed in another session. Reload it and try again.');
    return row;
  }

  private bumpVersion(tourId: string): void {
    this.db.prepare('UPDATE tours SET version = version + 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), tourId);
  }
}
