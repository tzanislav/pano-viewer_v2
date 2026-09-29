import { randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { NavigationLink, Page, Placement, PlanConnection, Scene, Tour, TourEditorData } from '@pano/domain';
import { AppError } from '../errors.js';
import { MediaRepository } from './mediaRepository.js';
import { UnderlayRepository } from './underlayRepository.js';

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

  shareToken(ownerUid: string, tourId: string): string | null {
    this.requireOwner(ownerUid, tourId);
    const row = this.db.prepare('SELECT token FROM tour_shares WHERE tour_id = ?').get(tourId) as { token: string } | undefined;
    return row?.token ?? null;
  }

  createShare(ownerUid: string, tourId: string): string {
    return this.db.transaction(() => {
      this.requireOwner(ownerUid, tourId);
      const existing = this.shareToken(ownerUid, tourId);
      if (existing) return existing;
      const token = randomBytes(32).toString('base64url');
      this.db.prepare('INSERT INTO tour_shares (tour_id, token, created_at) VALUES (?, ?, ?)')
        .run(tourId, token, new Date().toISOString());
      return token;
    })();
  }

  revokeShare(ownerUid: string, tourId: string): void {
    this.requireOwner(ownerUid, tourId);
    this.db.prepare('DELETE FROM tour_shares WHERE tour_id = ?').run(tourId);
  }

  sharedTour(token: string): { ownerUid: string; tourId: string } {
    const row = this.db.prepare(`SELECT t.owner_uid AS ownerUid, t.id AS tourId FROM tour_shares s
      JOIN tours t ON t.id = s.tour_id WHERE s.token = ?`).get(token) as { ownerUid: string; tourId: string } | undefined;
    if (!row) throw new AppError(404, 'SHARE_NOT_FOUND', 'This share link is unavailable');
    return row;
  }

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
    const underlays = new UnderlayRepository(this.db).list(ownerUid, id);
    return { tour: toTour(tour), pages, scenes, placements, connections, links, assets, underlays };
  }

  storageKeysForDelete(ownerUid: string, tourId: string, expectedVersion: number): string[] {
    this.requireVersion(ownerUid, tourId, expectedVersion);
    const assets = this.db.prepare('SELECT object_key, thumbnail_key FROM media_assets WHERE tour_id = ?')
      .all(tourId) as { object_key: string; thumbnail_key: string | null }[];
    return [...new Set(assets.flatMap(asset => asset.thumbnail_key
      ? [asset.object_key, asset.thumbnail_key] : [asset.object_key]))];
  }

  deleteTour(ownerUid: string, tourId: string, expectedVersion: number): void {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, expectedVersion);
      this.db.prepare('DELETE FROM tours WHERE id = ? AND owner_uid = ?').run(tourId, ownerUid);
    })();
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
      const page = this.db.prepare('SELECT id, plan_asset_id FROM pages WHERE id = ? AND tour_id = ?')
        .get(pageId, tourId) as { id: string; plan_asset_id: string | null } | undefined;
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
      const now = new Date().toISOString();
      if (page.plan_asset_id) this.db.prepare('UPDATE media_assets SET retired_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, page.plan_asset_id);
      this.db.prepare(`UPDATE media_assets SET retired_at = ?, updated_at = ? WHERE tour_id = ?
        AND underlay_page_id = ? AND retired_at IS NULL`).run(now, now, tourId, pageId);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  createPlacement(ownerUid: string, tourId: string, input: {
    pageId: string; sceneId: string; x: number; y: number; expectedVersion: number;
  }): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, input.expectedVersion);
      const page = this.db.prepare('SELECT id FROM pages WHERE id = ? AND tour_id = ?').get(input.pageId, tourId);
      if (!page) throw new AppError(404, 'PAGE_NOT_FOUND', 'Page not found');
      const scene = this.db.prepare(`SELECT s.id FROM scenes s JOIN media_assets m ON m.id = s.panorama_asset_id
        WHERE s.id = ? AND s.tour_id = ? AND m.status = 'ready' AND m.retired_at IS NULL`)
        .get(input.sceneId, tourId);
      if (!scene) throw new AppError(404, 'SCENE_NOT_FOUND', 'Ready photo not found');
      const existing = this.db.prepare('SELECT id FROM placements WHERE tour_id = ? AND scene_id = ?')
        .get(tourId, input.sceneId);
      if (existing) throw new AppError(409, 'SCENE_ALREADY_PLACED', 'This photo already has a canvas node');
      this.db.prepare('INSERT INTO placements (id, tour_id, page_id, scene_id, x, y) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), tourId, input.pageId, input.sceneId, input.x, input.y);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  updatePlacement(ownerUid: string, tourId: string, placementId: string, input: {
    x: number; y: number; expectedVersion: number;
  }): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, input.expectedVersion);
      const overlap = this.db.prepare(`SELECT c.id FROM plan_connections c
        JOIN placements other ON other.id = CASE WHEN c.placement_a_id = ? THEN c.placement_b_id ELSE c.placement_a_id END
        WHERE c.tour_id = ? AND (c.placement_a_id = ? OR c.placement_b_id = ?)
          AND other.x = ? AND other.y = ?`).get(placementId, tourId, placementId, placementId, input.x, input.y);
      if (overlap) throw new AppError(422, 'SAME_POSITION', 'Connected nodes must have different positions');
      const result = this.db.prepare('UPDATE placements SET x = ?, y = ? WHERE id = ? AND tour_id = ?')
        .run(input.x, input.y, placementId, tourId);
      if (!result.changes) throw new AppError(404, 'PLACEMENT_NOT_FOUND', 'Node not found');
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  deletePlacement(ownerUid: string, tourId: string, placementId: string, expectedVersion: number): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, expectedVersion);
      const placement = this.db.prepare('SELECT id FROM placements WHERE id = ? AND tour_id = ?')
        .get(placementId, tourId);
      if (!placement) throw new AppError(404, 'PLACEMENT_NOT_FOUND', 'Node not found');
      this.db.prepare(`DELETE FROM navigation_links WHERE tour_id = ? AND plan_connection_id IN (
        SELECT id FROM plan_connections WHERE tour_id = ? AND (placement_a_id = ? OR placement_b_id = ?)
      )`).run(tourId, tourId, placementId, placementId);
      this.db.prepare(`DELETE FROM plan_connections WHERE tour_id = ? AND (placement_a_id = ? OR placement_b_id = ?)`)
        .run(tourId, placementId, placementId);
      this.db.prepare('DELETE FROM placements WHERE id = ? AND tour_id = ?').run(placementId, tourId);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  deleteScene(ownerUid: string, tourId: string, sceneId: string, expectedVersion: number): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, expectedVersion);
      const scene = this.db.prepare('SELECT panorama_asset_id FROM scenes WHERE id = ? AND tour_id = ?')
        .get(sceneId, tourId) as { panorama_asset_id: string } | undefined;
      if (!scene) throw new AppError(404, 'SCENE_NOT_FOUND', 'Photo not found');
      const pending = this.db.prepare(`SELECT id FROM media_assets WHERE tour_id = ?
        AND replaces_scene_id = ? AND status IN ('uploading', 'processing') AND retired_at IS NULL`).get(tourId, sceneId);
      if (pending) throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'Wait for the replacement upload to finish or cancel it');

      this.db.prepare('UPDATE tours SET entry_scene_id = NULL WHERE id = ? AND entry_scene_id = ?')
        .run(tourId, sceneId);
      this.db.prepare(`DELETE FROM navigation_links WHERE tour_id = ?
        AND (source_scene_id = ? OR target_scene_id = ?)`).run(tourId, sceneId, sceneId);
      this.db.prepare(`DELETE FROM plan_connections WHERE tour_id = ? AND
        (placement_a_id IN (SELECT id FROM placements WHERE tour_id = ? AND scene_id = ?)
         OR placement_b_id IN (SELECT id FROM placements WHERE tour_id = ? AND scene_id = ?))`)
        .run(tourId, tourId, sceneId, tourId, sceneId);
      this.db.prepare('DELETE FROM placements WHERE tour_id = ? AND scene_id = ?').run(tourId, sceneId);
      this.db.prepare('DELETE FROM scenes WHERE id = ? AND tour_id = ?').run(sceneId, tourId);
      const now = new Date().toISOString();
      this.db.prepare(`UPDATE media_assets SET retired_at = ?, updated_at = ? WHERE tour_id = ?
        AND kind = 'panorama' AND retired_at IS NULL
        AND (id = ? OR replaces_scene_id = ?)`).run(now, now, tourId, scene.panorama_asset_id, sceneId);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  createPlanConnection(ownerUid: string, tourId: string, input: {
    placementAId: string; placementBId: string; expectedVersion: number;
  }): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, input.expectedVersion);
      if (input.placementAId === input.placementBId) throw new AppError(422, 'SELF_CONNECTION', 'Choose a different node');
      const placements = this.db.prepare('SELECT * FROM placements WHERE id = ? AND tour_id = ?');
      const first = placements.get(input.placementAId, tourId) as PlacementRow | undefined;
      const second = placements.get(input.placementBId, tourId) as PlacementRow | undefined;
      if (!first || !second) throw new AppError(404, 'PLACEMENT_NOT_FOUND', 'Node not found');
      if (first.page_id !== second.page_id) throw new AppError(422, 'DIFFERENT_PAGES', 'Choose a node on the same page');
      if (first.x === second.x && first.y === second.y) {
        throw new AppError(422, 'SAME_POSITION', 'Move one node before connecting them');
      }
      const [a, b] = [first.id, second.id].sort();
      const existing = this.db.prepare(`SELECT id FROM plan_connections
        WHERE tour_id = ? AND placement_a_id = ? AND placement_b_id = ?`).get(tourId, a, b);
      if (existing) throw new AppError(409, 'CONNECTION_EXISTS', 'These nodes are already connected');
      const connectionId = randomUUID();
      this.db.prepare(`INSERT INTO plan_connections (id, tour_id, placement_a_id, placement_b_id)
        VALUES (?, ?, ?, ?)`).run(connectionId, tourId, a, b);
      const insertLink = this.db.prepare(`INSERT INTO navigation_links
        (id, tour_id, source_scene_id, target_scene_id, plan_connection_id, position_mode)
        VALUES (?, ?, ?, ?, ?, 'auto')`);
      insertLink.run(randomUUID(), tourId, first.scene_id, second.scene_id, connectionId);
      insertLink.run(randomUUID(), tourId, second.scene_id, first.scene_id, connectionId);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  deletePlanConnection(ownerUid: string, tourId: string, connectionId: string, expectedVersion: number): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, expectedVersion);
      const connection = this.db.prepare('SELECT id FROM plan_connections WHERE id = ? AND tour_id = ?')
        .get(connectionId, tourId);
      if (!connection) throw new AppError(404, 'CONNECTION_NOT_FOUND', 'Connection not found');
      this.db.prepare('DELETE FROM navigation_links WHERE tour_id = ? AND plan_connection_id = ?').run(tourId, connectionId);
      this.db.prepare('DELETE FROM plan_connections WHERE id = ? AND tour_id = ?').run(connectionId, tourId);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  deletePlanDirection(ownerUid: string, tourId: string, linkId: string, expectedVersion: number): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, expectedVersion);
      const link = this.db.prepare('SELECT plan_connection_id FROM navigation_links WHERE id = ? AND tour_id = ?')
        .get(linkId, tourId) as { plan_connection_id: string | null } | undefined;
      if (!link?.plan_connection_id) throw new AppError(404, 'PLAN_LINK_NOT_FOUND', 'Plan direction not found');
      this.db.prepare('DELETE FROM navigation_links WHERE id = ? AND tour_id = ?').run(linkId, tourId);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  resetPlanDirection(ownerUid: string, tourId: string, linkId: string, expectedVersion: number): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, expectedVersion);
      const link = this.db.prepare('SELECT plan_connection_id FROM navigation_links WHERE id = ? AND tour_id = ?')
        .get(linkId, tourId) as { plan_connection_id: string | null } | undefined;
      if (!link?.plan_connection_id) throw new AppError(409, 'NOT_PLAN_LINK', 'Only plan links can reset to a plan direction');
      const connection = this.db.prepare(`SELECT a.page_id AS page_a, b.page_id AS page_b,
        a.x AS ax, a.y AS ay, b.x AS bx, b.y AS by FROM plan_connections c
        JOIN placements a ON a.id = c.placement_a_id JOIN placements b ON b.id = c.placement_b_id
        WHERE c.id = ? AND c.tour_id = ?`).get(link.plan_connection_id, tourId) as {
          page_a: string; page_b: string; ax: number; ay: number; bx: number; by: number;
        } | undefined;
      if (!connection || connection.page_a !== connection.page_b ||
        (connection.ax === connection.bx && connection.ay === connection.by)) {
        throw new AppError(409, 'NO_PLAN_DIRECTION', 'This connection has no plan direction');
      }
      this.db.prepare(`UPDATE navigation_links SET position_mode = 'auto', manual_yaw_deg = NULL,
        manual_pitch_deg = NULL WHERE id = ? AND tour_id = ?`).run(linkId, tourId);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  createViewerLink(ownerUid: string, tourId: string, input: {
    sourceSceneId: string; targetSceneId: string; yawDeg: number; pitchDeg: number; expectedVersion: number;
  }): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, input.expectedVersion);
      if (input.sourceSceneId === input.targetSceneId) throw new AppError(422, 'SELF_LINK', 'Choose a different destination photo');
      const ready = this.db.prepare(`SELECT s.id FROM scenes s JOIN media_assets m ON m.id = s.panorama_asset_id
        WHERE s.id = ? AND s.tour_id = ? AND m.status = 'ready' AND m.retired_at IS NULL`);
      if (!ready.get(input.sourceSceneId, tourId) || !ready.get(input.targetSceneId, tourId)) {
        throw new AppError(404, 'SCENE_NOT_FOUND', 'Ready photo not found');
      }
      this.db.prepare(`INSERT INTO navigation_links
        (id, tour_id, source_scene_id, target_scene_id, position_mode, manual_yaw_deg, manual_pitch_deg)
        VALUES (?, ?, ?, ?, 'manual', ?, ?)`).run(randomUUID(), tourId,
        input.sourceSceneId, input.targetSceneId, input.yawDeg, input.pitchDeg);
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  updateViewerLink(ownerUid: string, tourId: string, linkId: string, input: {
    yawDeg: number; pitchDeg: number; expectedVersion: number;
  }): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, input.expectedVersion);
      const result = this.db.prepare(`UPDATE navigation_links SET position_mode = 'manual',
        manual_yaw_deg = ?, manual_pitch_deg = ? WHERE id = ? AND tour_id = ?`)
        .run(input.yawDeg, input.pitchDeg, linkId, tourId);
      if (!result.changes) throw new AppError(404, 'LINK_NOT_FOUND', 'Link not found');
      this.bumpVersion(tourId);
    })();
    return this.get(ownerUid, tourId);
  }

  deleteViewerLink(ownerUid: string, tourId: string, linkId: string, expectedVersion: number): TourEditorData {
    this.db.transaction(() => {
      this.requireVersion(ownerUid, tourId, expectedVersion);
      const link = this.db.prepare('SELECT plan_connection_id FROM navigation_links WHERE id = ? AND tour_id = ?')
        .get(linkId, tourId) as { plan_connection_id: string | null } | undefined;
      if (!link) throw new AppError(404, 'LINK_NOT_FOUND', 'Link not found');
      if (link.plan_connection_id) throw new AppError(409, 'PLAN_LINK', 'Remove plan links from the canvas');
      this.db.prepare('DELETE FROM navigation_links WHERE id = ? AND tour_id = ?').run(linkId, tourId);
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
