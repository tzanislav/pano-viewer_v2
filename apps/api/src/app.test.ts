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

const databases: ReturnType<typeof openDatabase>[] = [];
const temporaryDirectories: string[] = [];

function testApp() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const storage: StorageGateway = {
    signUpload: async () => 'https://example.test/upload',
    head: async () => null,
    read: async () => Buffer.alloc(0),
    writeThumbnail: async () => {},
    signRead: async () => 'https://example.test/read',
    delete: async () => {}
  };
  const media = new MediaService(new MediaRepository(db), storage, {
    maxPanoramaBytes: 50_000_000, uploadUrlTtlSeconds: 900, readUrlTtlSeconds: 900
  });
  const app = createApp(new TourService(new TourRepository(db)), media, async (token) => {
    if (token === 'alice' || token === 'bob') return token;
    throw new Error('invalid token');
  }, 'http://localhost:5173');
  return { client: request(app), db };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('tour access and persistence', () => {
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
    expect(versions).toEqual([{ version: 1 }, { version: 2 }]);
    expect(new TourRepository(reopened).list('alice')[0].title).toBe('Saved tour');
  });
});
