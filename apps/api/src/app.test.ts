import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { openDatabase } from './repositories/database.js';
import { TourRepository } from './repositories/tourRepository.js';
import { TourService } from './services/tourService.js';
import { MediaService } from './services/mediaService.js';
import { MediaRepository } from './repositories/mediaRepository.js';
import type { StorageGateway } from './storage/StorageGateway.js';
import { UnderlayRepository } from './repositories/underlayRepository.js';
import { UnderlayService } from './services/underlayService.js';

const databases: ReturnType<typeof openDatabase>[] = [];
const temporaryDirectories: string[] = [];

function testApp() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const deletedKeys: string[] = [];
  let failingKey: string | null = null;
  const storage: StorageGateway = {
    signUpload: async () => 'https://example.test/upload',
    head: async () => null,
    read: async () => Buffer.alloc(0),
    writeThumbnail: async () => {},
    signRead: async () => 'https://example.test/read',
    delete: async key => {
      if (key === failingKey) throw new Error('Storage unavailable');
      deletedKeys.push(key);
    }
  };
  const media = new MediaService(new MediaRepository(db), storage, {
    maxPanoramaBytes: 50_000_000, uploadUrlTtlSeconds: 900, readUrlTtlSeconds: 900
  });
  const underlays = new UnderlayService(new UnderlayRepository(db), storage, {
    maxPanoramaBytes: 50_000_000, maxUnderlayBytes: 20_000_000, uploadUrlTtlSeconds: 900, readUrlTtlSeconds: 900
  });
  const app = createApp(new TourService(new TourRepository(db)), media, underlays, async (token) => {
    if (token === 'alice' || token === 'bob') return token;
    throw new Error('invalid token');
  }, 'http://localhost:5173');
  return { client: request(app), db, deletedKeys, failDeleteFor: (key: string | null) => { failingKey = key; } };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('tour access and persistence', () => {
  it('shares only the viewer and revokes the public link', async () => {
    const { client, db } = testApp();
    const alice = { Authorization: 'Bearer alice' };
    const created = await client.post('/api/tours').set(alice).send({ title: 'Shared home' });
    const tourId = created.body.tour.id as string;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO media_assets
      (id, tour_id, kind, object_key, thumbnail_key, mime_type, byte_size, status, created_at, updated_at)
      VALUES ('shared-photo', ?, 'panorama', 'shared-object', 'shared-thumb', 'image/jpeg', 100, 'ready', ?, ?)`)
      .run(tourId, now, now);
    db.prepare(`INSERT INTO scenes (id, tour_id, panorama_asset_id, name, sort_order)
      VALUES ('shared-scene', ?, 'shared-photo', 'Living room', 0)`).run(tourId);

    expect((await client.get(`/api/tours/${tourId}/share`).set(alice)).body.token).toBeNull();
    expect((await client.post(`/api/tours/${tourId}/share`).set('Authorization', 'Bearer bob')).status).toBe(404);
    const createdShare = await client.post(`/api/tours/${tourId}/share`).set(alice);
    const token = createdShare.body.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await client.post(`/api/tours/${tourId}/share`).set(alice)).body.token).toBe(token);
    expect((await client.get(`/api/tours/${tourId}/share`).set(alice)).body.token).toBe(token);

    const shared = await client.get(`/api/shares/${token}/manifest`);
    expect(shared.status).toBe(200);
    expect(shared.body.title).toBe('Shared home');
    expect(shared.body.scenes).toEqual([expect.objectContaining({ id: 'shared-scene', name: 'Living room',
      panoramaUrl: 'https://example.test/read', thumbnailUrl: 'https://example.test/read' })]);
    expect(shared.body).not.toHaveProperty('pages');
    expect((await client.get(`/api/tours/${tourId}`)).status).toBe(401);
    expect((await client.get(`/api/tours/${tourId}/viewer-manifest`)).status).toBe(401);
    expect((await client.patch(`/api/tours/${tourId}`).send({ title: 'Changed', expectedVersion: 1 })).status).toBe(401);

    expect((await client.delete(`/api/tours/${tourId}/share`).set(alice)).status).toBe(204);
    expect((await client.get(`/api/shares/${token}/manifest`)).status).toBe(404);
    const replacement = (await client.post(`/api/tours/${tourId}/share`).set(alice)).body.token as string;
    expect(replacement).not.toBe(token);
    expect((await client.delete(`/api/tours/${tourId}`).set(alice).send({ expectedVersion: 1 })).status).toBe(204);
    expect((await client.get(`/api/shares/${replacement}/manifest`)).status).toBe(404);
  });
  it('deletes a tour’s photos, underlays, graph, and storage only for its owner', async () => {
    const { client, db, deletedKeys, failDeleteFor } = testApp();
    const auth = { Authorization: 'Bearer alice' };
    const created = await client.post('/api/tours').set(auth).send({ title: 'Remove me' });
    const tourId = created.body.tour.id as string;
    const pageId = created.body.pages[0].id as string;
    const other = await client.post('/api/tours').set(auth).send({ title: 'Keep me' });
    const now = new Date().toISOString();
    const mediaRows = [
      { id: 'photo-a', kind: 'panorama', key: `tours/${tourId}/panoramas/a`, thumbnail: `tours/${tourId}/thumbnails/a.jpg`, retired: null },
      { id: 'photo-b', kind: 'panorama', key: `tours/${tourId}/panoramas/b`, thumbnail: `tours/${tourId}/thumbnails/b.jpg`, retired: null },
      { id: 'retired', kind: 'panorama', key: `tours/${tourId}/panoramas/retired`, thumbnail: null, retired: now },
      { id: 'pending', kind: 'panorama', key: `tours/${tourId}/panoramas/pending`, thumbnail: null, retired: null },
      { id: 'underlay', kind: 'plan', key: `tours/${tourId}/underlays/plan`, thumbnail: null, retired: null }
    ] as const;
    for (const row of mediaRows) db.prepare(`INSERT INTO media_assets
      (id, tour_id, kind, object_key, thumbnail_key, mime_type, byte_size, status, retired_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'image/jpeg', 100, ?, ?, ?, ?)`).run(
      row.id, tourId, row.kind, row.key, row.thumbnail, row.id === 'pending' ? 'uploading' : 'ready', row.retired, now, now);
    db.prepare('UPDATE pages SET plan_asset_id = ? WHERE id = ?').run('underlay', pageId);
    for (const [id, assetId, order] of [['scene-a', 'photo-a', 0], ['scene-b', 'photo-b', 1]] as const) {
      db.prepare('INSERT INTO scenes (id, tour_id, panorama_asset_id, name, sort_order) VALUES (?, ?, ?, ?, ?)')
        .run(id, tourId, assetId, id, order);
    }
    db.prepare('INSERT INTO placements (id, tour_id, page_id, scene_id, x, y) VALUES (?, ?, ?, ?, 100, 100)')
      .run('node-a', tourId, pageId, 'scene-a');
    db.prepare('INSERT INTO placements (id, tour_id, page_id, scene_id, x, y) VALUES (?, ?, ?, ?, 500, 500)')
      .run('node-b', tourId, pageId, 'scene-b');
    db.prepare('INSERT INTO plan_connections (id, tour_id, placement_a_id, placement_b_id) VALUES (?, ?, ?, ?)')
      .run('line', tourId, 'node-a', 'node-b');
    db.prepare(`INSERT INTO navigation_links
      (id, tour_id, source_scene_id, target_scene_id, plan_connection_id, position_mode)
      VALUES (?, ?, ?, ?, ?, 'auto')`).run('link', tourId, 'scene-a', 'scene-b', 'line');

    const forbidden = await client.delete(`/api/tours/${tourId}`).set('Authorization', 'Bearer bob')
      .send({ expectedVersion: 1 });
    expect(forbidden.status).toBe(404);
    const stale = await client.delete(`/api/tours/${tourId}`).set(auth).send({ expectedVersion: 2 });
    expect(stale.status).toBe(409);
    expect(deletedKeys).toEqual([]);

    failDeleteFor(mediaRows[0].key);
    const failed = await client.delete(`/api/tours/${tourId}`).set(auth).send({ expectedVersion: 1 });
    expect(failed.status).toBe(500);
    expect(db.prepare('SELECT id FROM tours WHERE id = ?').get(tourId)).toBeTruthy();
    failDeleteFor(null);
    const deleted = await client.delete(`/api/tours/${tourId}`).set(auth).send({ expectedVersion: 1 });
    expect(deleted.status).toBe(204);
    expect(deletedKeys.sort()).toEqual(mediaRows.flatMap(row => row.thumbnail ? [row.key, row.thumbnail] : [row.key]).sort());
    for (const table of ['tours', 'media_assets', 'pages', 'scenes', 'placements', 'plan_connections', 'navigation_links']) {
      const count = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'tours' ? 'id' : 'tour_id'} = ?`)
        .get(tourId) as { count: number };
      expect(count.count).toBe(0);
    }
    const list = await client.get('/api/tours').set(auth);
    expect(list.body.tours.map((tour: { id: string }) => tour.id)).toEqual([other.body.tour.id]);
  });

  it('rejects missing and invalid credentials with a request ID', async () => {
    const { client } = testApp();
    for (const header of [undefined, 'Bearer invalid']) {
      const response = await client.get('/api/tours').set(header ? { Authorization: header } : {});
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
      expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    }
  });

  it('scopes tours and pages to the verified owner and persists versioned edits', async () => {
    const { client } = testApp();
    const created = await client.post('/api/tours').set('Authorization', 'Bearer alice').send({ title: 'Home' });
    expect(created.status).toBe(201);
    expect(created.body.pages).toHaveLength(1);
    const id = created.body.tour.id as string;

    const otherList = await client.get('/api/tours').set('Authorization', 'Bearer bob');
    expect(otherList.body.tours).toEqual([]);
    const otherRead = await client.get(`/api/tours/${id}`).set('Authorization', 'Bearer bob');
    expect(otherRead.status).toBe(404);
    const otherWrite = await client.post(`/api/tours/${id}/pages`).set('Authorization', 'Bearer bob')
      .send({ name: 'Secret', expectedVersion: 1 });
    expect(otherWrite.status).toBe(404);

    const added = await client.post(`/api/tours/${id}/pages`).set('Authorization', 'Bearer alice')
      .send({ name: 'First floor', expectedVersion: 1 });
    expect(added.status).toBe(201);
    expect(added.body.pages).toHaveLength(2);
    expect(added.body.tour.version).toBe(2);
    const stale = await client.patch(`/api/tours/${id}`).set('Authorization', 'Bearer alice')
      .send({ title: 'Stale', expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const reloaded = await client.get(`/api/tours/${id}`).set('Authorization', 'Bearer alice');
    expect(reloaded.body.tour.title).toBe('Home');
    expect(reloaded.body.pages[1].name).toBe('First floor');
  });

  it('keeps the last page and removes a deleted page’s nodes and plan links', async () => {
    const { client, db } = testApp();
    const created = await client.post('/api/tours').set('Authorization', 'Bearer alice').send({ title: 'Home' });
    const tourId = created.body.tour.id as string;
    const groundId = created.body.pages[0].id as string;
    const lastPage = await client.delete(`/api/tours/${tourId}/pages/${groundId}`)
      .set('Authorization', 'Bearer alice').send({ expectedVersion: 1 });
    expect(lastPage.status).toBe(409);
    expect(lastPage.body.error.code).toBe('LAST_PAGE');

    const added = await client.post(`/api/tours/${tourId}/pages`).set('Authorization', 'Bearer alice')
      .send({ name: 'Top floor', expectedVersion: 1 });
    const topId = added.body.pages[1].id as string;
    const stale = await client.delete(`/api/tours/${tourId}/pages/${topId}`)
      .set('Authorization', 'Bearer alice').send({ expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const now = new Date().toISOString();
    for (const key of ['a', 'b', 'c']) {
      db.prepare(`INSERT INTO media_assets
        (id, tour_id, kind, object_key, mime_type, byte_size, status, created_at, updated_at)
        VALUES (?, ?, 'panorama', ?, 'image/jpeg', 100, 'ready', ?, ?)`)
        .run(`asset-${key}`, tourId, `tours/${tourId}/${key}`, now, now);
      db.prepare('INSERT INTO scenes (id, tour_id, panorama_asset_id, name, sort_order) VALUES (?, ?, ?, ?, ?)')
        .run(`scene-${key}`, tourId, `asset-${key}`, key, key.charCodeAt(0));
    }
    db.prepare('INSERT INTO placements (id, tour_id, page_id, scene_id, x, y) VALUES (?, ?, ?, ?, 100, 100)')
      .run('placement-a', tourId, topId, 'scene-a');
    db.prepare('INSERT INTO placements (id, tour_id, page_id, scene_id, x, y) VALUES (?, ?, ?, ?, 500, 500)')
      .run('placement-b', tourId, groundId, 'scene-b');
    db.prepare('INSERT INTO plan_connections (id, tour_id, placement_a_id, placement_b_id) VALUES (?, ?, ?, ?)')
      .run('connection-ab', tourId, 'placement-a', 'placement-b');
    db.prepare(`INSERT INTO navigation_links
      (id, tour_id, source_scene_id, target_scene_id, plan_connection_id, position_mode)
      VALUES (?, ?, ?, ?, ?, 'auto')`).run('link-ab', tourId, 'scene-a', 'scene-b', 'connection-ab');
    db.prepare(`INSERT INTO navigation_links
      (id, tour_id, source_scene_id, target_scene_id, plan_connection_id, position_mode, manual_yaw_deg, manual_pitch_deg)
      VALUES (?, ?, ?, ?, ?, 'manual', 120, 20)`).run('link-ba', tourId, 'scene-b', 'scene-a', 'connection-ab');
    db.prepare(`INSERT INTO navigation_links
      (id, tour_id, source_scene_id, target_scene_id, position_mode, manual_yaw_deg, manual_pitch_deg)
      VALUES (?, ?, ?, ?, 'manual', 45, 0)`).run('viewer-link', tourId, 'scene-a', 'scene-c');

    const forbidden = await client.delete(`/api/tours/${tourId}/pages/${topId}`)
      .set('Authorization', 'Bearer bob').send({ expectedVersion: 2 });
    expect(forbidden.status).toBe(404);
    const deleted = await client.delete(`/api/tours/${tourId}/pages/${topId}`)
      .set('Authorization', 'Bearer alice').send({ expectedVersion: 2 });
    expect(deleted.status).toBe(200);
    expect(deleted.body.pages.map((page: { id: string }) => page.id)).toEqual([groundId]);
    expect(deleted.body.placements.map((placement: { sceneId: string }) => placement.sceneId)).toEqual(['scene-b']);
    expect(deleted.body.scenes).toHaveLength(3);
    expect(deleted.body.connections).toEqual([]);
    expect(deleted.body.links.map((link: { id: string }) => link.id)).toEqual(['viewer-link']);
    expect(deleted.body.tour.version).toBe(3);
  });

  it('reopens a populated database without rerunning the migration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pano-api-test-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'tour.sqlite');
    const first = openDatabase(path);
    new TourRepository(first).create('alice', 'Saved tour');
    first.close();
    const reopened = openDatabase(path);
    databases.push(reopened);
    const versions = reopened.prepare('SELECT version FROM schema_migrations').all();
    expect(versions).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
    expect(new TourRepository(reopened).list('alice')[0].title).toBe('Saved tour');
  });
});
