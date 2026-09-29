import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from './app.js';
import { openDatabase } from './repositories/database.js';
import { MediaRepository } from './repositories/mediaRepository.js';
import { TourRepository } from './repositories/tourRepository.js';
import { MediaService } from './services/mediaService.js';
import { TourService } from './services/tourService.js';
import type { StorageGateway } from './storage/StorageGateway.js';
import { UnderlayRepository } from './repositories/underlayRepository.js';
import { UnderlayService } from './services/underlayService.js';

const databases: ReturnType<typeof openDatabase>[] = [];

class MemoryStorage implements StorageGateway {
  objects = new Map<string, { bytes: Buffer; mimeType: string }>();
  deleted: string[] = [];
  async signUpload(key: string) { return `https://upload.test/${key}`; }
  async head(key: string) {
    const item = this.objects.get(key);
    return item ? { byteSize: item.bytes.length, mimeType: item.mimeType } : null;
  }
  async read(key: string) { return this.objects.get(key)?.bytes || Buffer.alloc(0); }
  async writeThumbnail(key: string, bytes: Buffer) { this.objects.set(key, { bytes, mimeType: 'image/jpeg' }); }
  async signRead(key: string) { return `https://read.test/${key}`; }
  async delete(key: string) { this.deleted.push(key); this.objects.delete(key); }
}

function fixture() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const storage = new MemoryStorage();
  const media = new MediaService(new MediaRepository(db), storage, {
    maxPanoramaBytes: 20_000_000, uploadUrlTtlSeconds: 900, readUrlTtlSeconds: 900
  });
  const underlays = new UnderlayService(new UnderlayRepository(db), storage, {
    maxPanoramaBytes: 20_000_000, maxUnderlayBytes: 20_000_000, uploadUrlTtlSeconds: 900, readUrlTtlSeconds: 900
  });
  const app = createApp(new TourService(new TourRepository(db)), media, underlays, async token => {
    if (token === 'alice' || token === 'bob') return token;
    throw new Error('invalid token');
  }, 'http://localhost:5173');
  return { client: request(app), db, storage };
}

async function panorama(color: string) {
  return sharp({ create: { width: 1024, height: 512, channels: 3, background: color } }).jpeg().toBuffer();
}

async function reserve(client: ReturnType<typeof request>, tourId: string, fileName: string, bytes: Buffer) {
  return client.post(`/api/tours/${tourId}/uploads`).set('Authorization', 'Bearer alice')
    .send({ fileName, mimeType: 'image/jpeg', byteSize: bytes.length });
}

afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe('panorama uploads', () => {
  it('builds an owner-scoped manifest and keeps repeated viewer links independent', async () => {
    const { client, storage } = fixture();
    const created = await client.post('/api/tours').set('Authorization', 'Bearer alice').send({ title: 'Rooms' });
    const tourId = created.body.tour.id as string;
    const bytes = await panorama('blue');
    const ids: string[] = [];
    for (const name of ['Hall.jpg', 'Kitchen.jpg']) {
      const upload = await reserve(client, tourId, name, bytes);
      storage.objects.set(`tours/${tourId}/panoramas/${upload.body.asset.id}`, { bytes, mimeType: 'image/jpeg' });
      const ready = await client.post(`/api/tours/${tourId}/uploads/${upload.body.asset.id}/complete`)
        .set('Authorization', 'Bearer alice');
      ids.push(ready.body.sceneId as string);
    }
    const path = `/api/tours/${tourId}/viewer-manifest`;
    expect((await client.get(path)).status).toBe(401);
    expect((await client.get(path).set('Authorization', 'Bearer bob')).status).toBe(404);
    const manifest = await client.get(path).set('Authorization', 'Bearer alice');
    expect(manifest.status).toBe(200);
    expect(manifest.body.scenes).toHaveLength(2);
    expect(manifest.body.entrySceneId).toBe(ids[0]);
    expect(manifest.body.scenes[0].panoramaUrl).toContain('/panoramas/');
    expect(manifest.body.scenes[0].thumbnailUrl).toContain('/thumbnails/');

    let version = (await client.get(`/api/tours/${tourId}`).set('Authorization', 'Bearer alice')).body.tour.version as number;
    const linkPath = `/api/tours/${tourId}/links`;
    const linkIds: string[] = [];
    for (const pitchDeg of [45, -45]) {
      const added = await client.post(linkPath).set('Authorization', 'Bearer alice')
        .send({ sourceSceneId: ids[0], targetSceneId: ids[1], yawDeg: 90,
          pitchDeg, expectedVersion: version });
      expect(added.status).toBe(201);
      version = added.body.tour.version;
      linkIds.push(added.body.links.find((link: { manualPitchDeg: number }) => link.manualPitchDeg === pitchDeg).id as string);
    }
    expect(new Set(linkIds).size).toBe(2);
    const withLinks = await client.get(path).set('Authorization', 'Bearer alice');
    expect(withLinks.body.scenes[0].links).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: linkIds[0], targetSceneId: ids[1], yawDeg: 90, pitchDeg: 45 }),
      expect.objectContaining({ id: linkIds[1], targetSceneId: ids[1], yawDeg: 90, pitchDeg: -45 })
    ]));
    const denied = await client.patch(`${linkPath}/${linkIds[0]}`).set('Authorization', 'Bearer bob')
      .send({ yawDeg: 10, pitchDeg: 0, expectedVersion: version });
    expect(denied.status).toBe(404);
    const changed = await client.patch(`${linkPath}/${linkIds[0]}`).set('Authorization', 'Bearer alice')
      .send({ yawDeg: -90, pitchDeg: 20, expectedVersion: version });
    expect(changed.status).toBe(200);
    expect(changed.body.links.find((link: { id: string }) => link.id === linkIds[0]))
      .toMatchObject({ manualYawDeg: 270, manualPitchDeg: 20 });
    const after = await client.get(path).set('Authorization', 'Bearer alice');
    expect(after.body.scenes[0].links.find((link: { id: string }) => link.id === linkIds[1]).pitchDeg).toBe(-45);
  });

  it('creates a scene and replaces the same photo name without losing its placement or links', async () => {
    const { client, db, storage } = fixture();
    const tour = await client.post('/api/tours').set('Authorization', 'Bearer alice').send({ title: 'House' });
    const tourId = tour.body.tour.id as string;
    const pageId = tour.body.pages[0].id as string;
    const firstBytes = await panorama('red');
    const otherBytes = await panorama('blue');
    const first = await reserve(client, tourId, 'Kitchen.JPG', firstBytes);
    expect(first.status).toBe(201);
    expect(first.body.uploadUrl).toContain(first.body.asset.id);
    const firstKey = `tours/${tourId}/panoramas/${first.body.asset.id}`;
    storage.objects.set(firstKey, { bytes: firstBytes, mimeType: 'image/jpeg' });
    const firstDone = await client.post(`/api/tours/${tourId}/uploads/${first.body.asset.id}/complete`)
      .set('Authorization', 'Bearer alice');
    expect(firstDone.status).toBe(200);
    expect(firstDone.body.asset.status).toBe('ready');
    const sceneId = firstDone.body.sceneId as string;
    const second = await reserve(client, tourId, 'Hall.jpg', otherBytes);
    const secondKey = `tours/${tourId}/panoramas/${second.body.asset.id}`;
    storage.objects.set(secondKey, { bytes: otherBytes, mimeType: 'image/jpeg' });
    const secondDone = await client.post(`/api/tours/${tourId}/uploads/${second.body.asset.id}/complete`)
      .set('Authorization', 'Bearer alice');
    expect(secondDone.status).toBe(200);
    const hallSceneId = secondDone.body.sceneId as string;
    db.prepare('INSERT INTO placements (id, tour_id, page_id, scene_id, x, y) VALUES (?, ?, ?, ?, 120, 340)')
      .run('placement', tourId, pageId, sceneId);
    db.prepare(`INSERT INTO navigation_links
      (id, tour_id, source_scene_id, target_scene_id, position_mode, manual_yaw_deg, manual_pitch_deg)
      VALUES (?, ?, ?, ?, 'manual', 35, 10)`).run('link', tourId, sceneId, hallSceneId);
    const replacement = await reserve(client, tourId, 'kitchen.jpeg', otherBytes);
    expect(replacement.status).toBe(201);
    expect(replacement.body.asset.replacesSceneId).toBe(sceneId);
    const pending = await client.get(`/api/tours/${tourId}`).set('Authorization', 'Bearer alice');
    expect(pending.body.scenes.find((scene: { id: string }) => scene.id === sceneId).panoramaAssetId)
      .toBe(first.body.asset.id);
    const pendingConflict = await reserve(client, tourId, 'KITCHEN.jpg', otherBytes);
    expect(pendingConflict.status).toBe(409);
    const otherTour = await client.post('/api/tours').set('Authorization', 'Bearer alice').send({ title: 'Second house' });
    const sameNameElsewhere = await reserve(client, otherTour.body.tour.id as string, 'Kitchen.jpg', otherBytes);
    expect(sameNameElsewhere.status).toBe(201);
    expect(sameNameElsewhere.body.asset.replacesSceneId).toBeNull();
    const replacementKey = `tours/${tourId}/panoramas/${replacement.body.asset.id}`;
    storage.objects.set(replacementKey, { bytes: otherBytes, mimeType: 'image/jpeg' });
    const done = await client.post(`/api/tours/${tourId}/uploads/${replacement.body.asset.id}/complete`)
      .set('Authorization', 'Bearer alice');
    expect(done.status).toBe(200);
    expect(done.body.sceneId).toBe(sceneId);
    const reloaded = await client.get(`/api/tours/${tourId}`).set('Authorization', 'Bearer alice');
    expect(reloaded.body.scenes).toHaveLength(2);
    expect(reloaded.body.scenes.find((scene: { id: string }) => scene.id === sceneId).panoramaAssetId)
      .toBe(replacement.body.asset.id);
    expect(reloaded.body.placements).toEqual([expect.objectContaining({ sceneId, x: 120, y: 340 })]);
    expect(reloaded.body.links).toEqual([expect.objectContaining({ id: 'link', sourceSceneId: sceneId, targetSceneId: hallSceneId })]);
    expect(reloaded.body.assets.map((asset: { id: string }) => asset.id)).not.toContain(first.body.asset.id);
    expect(storage.deleted).toContain(firstKey);
    const thumb = await client.get(`/api/tours/${tourId}/assets/${replacement.body.asset.id}/thumbnail-url`)
      .set('Authorization', 'Bearer alice');
    expect(thumb.status).toBe(200);
    expect(thumb.body.url).toContain(replacement.body.asset.id);
    const privateRead = await client.get(`/api/tours/${tourId}/assets/${replacement.body.asset.id}/read-url`)
      .set('Authorization', 'Bearer bob');
    expect(privateRead.status).toBe(404);
  });

  it('keeps the ready photo when a replacement fails validation', async () => {
    const { client, storage } = fixture();
    const tour = await client.post('/api/tours').set('Authorization', 'Bearer alice').send({ title: 'House' });
    const tourId = tour.body.tour.id as string;
    const bytes = await panorama('green');
    const first = await reserve(client, tourId, 'Room.jpg', bytes);
    storage.objects.set(`tours/${tourId}/panoramas/${first.body.asset.id}`, { bytes, mimeType: 'image/jpeg' });
    await client.post(`/api/tours/${tourId}/uploads/${first.body.asset.id}/complete`).set('Authorization', 'Bearer alice');
    const bad = Buffer.from('not an image');
    const replacement = await reserve(client, tourId, 'room.jpeg', bad);
    storage.objects.set(`tours/${tourId}/panoramas/${replacement.body.asset.id}`, { bytes: bad, mimeType: 'image/jpeg' });
    const failed = await client.post(`/api/tours/${tourId}/uploads/${replacement.body.asset.id}/complete`)
      .set('Authorization', 'Bearer alice');
    expect(failed.status).toBe(422);
    expect(failed.body.error.code).toBe('INVALID_IMAGE');
    const reloaded = await client.get(`/api/tours/${tourId}`).set('Authorization', 'Bearer alice');
    expect(reloaded.body.scenes).toHaveLength(1);
    expect(reloaded.body.scenes[0].panoramaAssetId).toBe(first.body.asset.id);
    expect(reloaded.body.assets.find((asset: { id: string }) => asset.id === replacement.body.asset.id).status).toBe('error');
  });

  it('cancels an interrupted upload so the same photo name can be selected again', async () => {
    const { client, storage } = fixture();
    const tour = await client.post('/api/tours').set('Authorization', 'Bearer alice').send({ title: 'House' });
    const tourId = tour.body.tour.id as string;
    const bytes = await panorama('yellow');
    const pending = await reserve(client, tourId, 'Office.jpg', bytes);
    const key = `tours/${tourId}/panoramas/${pending.body.asset.id}`;
    storage.objects.set(key, { bytes, mimeType: 'image/jpeg' });
    const otherOwner = await client.delete(`/api/tours/${tourId}/uploads/${pending.body.asset.id}`)
      .set('Authorization', 'Bearer bob');
    expect(otherOwner.status).toBe(404);
    const canceled = await client.delete(`/api/tours/${tourId}/uploads/${pending.body.asset.id}`)
      .set('Authorization', 'Bearer alice');
    expect(canceled.status).toBe(204);
    expect(storage.deleted).toContain(key);
    const retry = await reserve(client, tourId, 'office.jpeg', bytes);
    expect(retry.status).toBe(201);
  });
});
