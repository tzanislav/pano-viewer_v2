import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from './app.js';
import { openDatabase } from './repositories/database.js';
import { MediaRepository } from './repositories/mediaRepository.js';
import { TourRepository } from './repositories/tourRepository.js';
import { UnderlayRepository } from './repositories/underlayRepository.js';
import { MediaService } from './services/mediaService.js';
import { TourService } from './services/tourService.js';
import { UnderlayService } from './services/underlayService.js';
import type { StorageGateway } from './storage/StorageGateway.js';

const databases: ReturnType<typeof openDatabase>[] = [];

class Storage implements StorageGateway {
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
  const storage = new Storage();
  const limits = { maxPanoramaBytes: 20_000_000, maxUnderlayBytes: 20_000_000,
    uploadUrlTtlSeconds: 900, readUrlTtlSeconds: 900 };
  const app = createApp(new TourService(new TourRepository(db)),
    new MediaService(new MediaRepository(db), storage, limits),
    new UnderlayService(new UnderlayRepository(db), storage, limits),
    async token => {
      if (token === 'alice' || token === 'bob') return token;
      throw new Error('invalid token');
    }, 'http://localhost:5173');
  return { client: request(app), db, storage };
}

const auth = { Authorization: 'Bearer alice' };
async function image(width: number, height: number, color: string) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe('page underlays and canvas nodes', () => {
  it('scopes an underlay to its page and preserves the old image if a replacement fails', async () => {
    const { client, storage } = fixture();
    const tour = await client.post('/api/tours').set(auth).send({ title: 'Home' });
    const tourId = tour.body.tour.id as string;
    const firstPage = tour.body.pages[0].id as string;
    const added = await client.post(`/api/tours/${tourId}/pages`).set(auth)
      .send({ name: 'Upper floor', expectedVersion: 1 });
    const secondPage = added.body.pages[1].id as string;
    const bytes = await image(800, 600, 'white');
    const reservePath = `/api/tours/${tourId}/pages/${firstPage}/underlay/uploads`;
    const first = await client.post(reservePath).set(auth)
      .send({ fileName: 'Floor.png', mimeType: 'image/png', byteSize: bytes.length });
    expect(first.status).toBe(201);
    const firstKey = `tours/${tourId}/underlays/${first.body.upload.id}`;
    storage.objects.set(firstKey, { bytes, mimeType: 'image/png' });
    const done = await client.post(`${reservePath}/${first.body.upload.id}/complete`).set(auth);
    expect(done.status).toBe(200);
    expect(done.body.upload.width).toBe(800);
    const loaded = await client.get(`/api/tours/${tourId}`).set(auth);
    expect(loaded.body.pages[0].planAssetId).toBe(first.body.upload.id);
    expect(loaded.body.pages[1].planAssetId).toBeNull();
    expect((await client.get(`/api/tours/${tourId}/pages/${secondPage}/underlay-url`).set(auth)).status).toBe(404);
    expect((await client.get(`/api/tours/${tourId}/pages/${firstPage}/underlay-url`)
      .set('Authorization', 'Bearer bob')).status).toBe(404);

    const invalid = Buffer.from('not an image');
    const replacement = await client.post(reservePath).set(auth)
      .send({ fileName: 'New floor.png', mimeType: 'image/png', byteSize: invalid.length });
    storage.objects.set(`tours/${tourId}/underlays/${replacement.body.upload.id}`,
      { bytes: invalid, mimeType: 'image/png' });
    const failed = await client.post(`${reservePath}/${replacement.body.upload.id}/complete`).set(auth);
    expect(failed.status).toBe(422);
    const afterFailure = await client.get(`/api/tours/${tourId}`).set(auth);
    expect(afterFailure.body.pages[0].planAssetId).toBe(first.body.upload.id);

    const otherBytes = await image(600, 800, 'blue');
    const replacement2 = await client.post(reservePath).set(auth)
      .send({ fileName: 'New floor.png', mimeType: 'image/png', byteSize: otherBytes.length });
    const secondKey = `tours/${tourId}/underlays/${replacement2.body.upload.id}`;
    storage.objects.set(secondKey, { bytes: otherBytes, mimeType: 'image/png' });
    expect((await client.post(`${reservePath}/${replacement2.body.upload.id}/complete`).set(auth)).status).toBe(200);
    const afterReplacement = await client.get(`/api/tours/${tourId}`).set(auth);
    expect(afterReplacement.body.pages[0].planAssetId).toBe(replacement2.body.upload.id);
    expect(storage.deleted).toContain(firstKey);
    const removed = await client.delete(`/api/tours/${tourId}/pages/${firstPage}/underlay`).set(auth)
      .send({ expectedVersion: afterReplacement.body.tour.version });
    expect(removed.status).toBe(200);
    expect(removed.body.pages[0].planAssetId).toBeNull();
    expect(storage.deleted).toContain(secondKey);
  });

  it('places each ready scene once and keeps node positions when an underlay is removed', async () => {
    const { client, storage } = fixture();
    const tour = await client.post('/api/tours').set(auth).send({ title: 'Home' });
    const tourId = tour.body.tour.id as string;
    const pageId = tour.body.pages[0].id as string;
    const bytes = await image(1024, 512, 'red');
    const uploaded = await client.post(`/api/tours/${tourId}/uploads`).set(auth)
      .send({ fileName: 'Hall.png', mimeType: 'image/png', byteSize: bytes.length });
    storage.objects.set(`tours/${tourId}/panoramas/${uploaded.body.asset.id}`, { bytes, mimeType: 'image/png' });
    const ready = await client.post(`/api/tours/${tourId}/uploads/${uploaded.body.asset.id}/complete`).set(auth);
    const sceneId = ready.body.sceneId as string;
    const current = await client.get(`/api/tours/${tourId}`).set(auth);
    const placed = await client.post(`/api/tours/${tourId}/placements`).set(auth)
      .send({ pageId, sceneId, x: 250, y: 725, expectedVersion: current.body.tour.version });
    expect(placed.status).toBe(201);
    const placementId = placed.body.placements[0].id as string;
    const duplicate = await client.post(`/api/tours/${tourId}/placements`).set(auth)
      .send({ pageId, sceneId, x: 300, y: 300, expectedVersion: placed.body.tour.version });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('SCENE_ALREADY_PLACED');
    const moved = await client.patch(`/api/tours/${tourId}/placements/${placementId}`).set(auth)
      .send({ x: 610, y: 180, expectedVersion: placed.body.tour.version });
    expect(moved.status).toBe(200);
    expect(moved.body.placements[0]).toMatchObject({ x: 610, y: 180 });
    const planBytes = await image(600, 400, 'white');
    const planPath = `/api/tours/${tourId}/pages/${pageId}/underlay/uploads`;
    const plan = await client.post(planPath).set(auth)
      .send({ fileName: 'Plan.png', mimeType: 'image/png', byteSize: planBytes.length });
    storage.objects.set(`tours/${tourId}/underlays/${plan.body.upload.id}`, { bytes: planBytes, mimeType: 'image/png' });
    await client.post(`${planPath}/${plan.body.upload.id}/complete`).set(auth);
    const withPlan = await client.get(`/api/tours/${tourId}`).set(auth);
    const noPlan = await client.delete(`/api/tours/${tourId}/pages/${pageId}/underlay`).set(auth)
      .send({ expectedVersion: withPlan.body.tour.version });
    expect(noPlan.body.placements[0]).toMatchObject({ x: 610, y: 180, sceneId });
    const blocked = await client.delete(`/api/tours/${tourId}/placements/${placementId}`)
      .set('Authorization', 'Bearer bob').send({ expectedVersion: noPlan.body.tour.version });
    expect(blocked.status).toBe(404);
    const deleted = await client.delete(`/api/tours/${tourId}/placements/${placementId}`)
      .set(auth).send({ expectedVersion: noPlan.body.tour.version });
    expect(deleted.body.placements).toEqual([]);
    expect(deleted.body.scenes).toHaveLength(1);
  });
});
