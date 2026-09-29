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

describe('same-page plan connections', () => {
  it('creates one line relationship with two directed links and preserves manual overrides', async () => {
    const { client, storage } = fixture();
    const tour = await client.post('/api/tours').set(auth).send({ title: 'Home' });
    const tourId = tour.body.tour.id as string;
    const pageId = tour.body.pages[0].id as string;
    const bytes = await image(1024, 512, 'blue');
    let version = tour.body.tour.version as number;
    const sceneIds: string[] = [];
    const placementIds: string[] = [];
    for (const [index, name] of ['West', 'East'].entries()) {
      const upload = await client.post(`/api/tours/${tourId}/uploads`).set(auth)
        .send({ fileName: `${name}.png`, mimeType: 'image/png', byteSize: bytes.length });
      storage.objects.set(`tours/${tourId}/panoramas/${upload.body.asset.id}`, { bytes, mimeType: 'image/png' });
      const ready = await client.post(`/api/tours/${tourId}/uploads/${upload.body.asset.id}/complete`).set(auth);
      sceneIds.push(ready.body.sceneId);
      version = (await client.get(`/api/tours/${tourId}`).set(auth)).body.tour.version;
      const placed = await client.post(`/api/tours/${tourId}/placements`).set(auth)
        .send({ pageId, sceneId: sceneIds[index], x: 100 + index * 200, y: 100, expectedVersion: version });
      expect(placed.status).toBe(201);
      placementIds.push(placed.body.placements.find((item: { sceneId: string }) => item.sceneId === sceneIds[index]).id);
      version = placed.body.tour.version;
    }
    const path = `/api/tours/${tourId}/connections`;
    const added = await client.post(path).set(auth).send({ placementAId: placementIds[1],
      placementBId: placementIds[0], expectedVersion: version });
    expect(added.status).toBe(201);
    expect(added.body.connections).toHaveLength(1);
    expect(added.body.links).toHaveLength(2);
    const connectionId = added.body.connections[0].id as string;
    const westToEast = added.body.links.find((link: { sourceSceneId: string }) => link.sourceSceneId === sceneIds[0]);
    const eastToWest = added.body.links.find((link: { sourceSceneId: string }) => link.sourceSceneId === sceneIds[1]);
    expect(westToEast).toMatchObject({ planConnectionId: connectionId, positionMode: 'auto' });
    expect(eastToWest).toMatchObject({ planConnectionId: connectionId, positionMode: 'auto' });
    const duplicate = await client.post(path).set(auth).send({ placementAId: placementIds[0],
      placementBId: placementIds[1], expectedVersion: added.body.tour.version });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONNECTION_EXISTS');
    expect((await client.post(path).set('Authorization', 'Bearer bob').send({ placementAId: placementIds[0],
      placementBId: placementIds[1], expectedVersion: added.body.tour.version })).status).toBe(404);
    const manifest = await client.get(`/api/tours/${tourId}/viewer-manifest`).set(auth);
    expect(manifest.body.scenes.find((scene: { id: string }) => scene.id === sceneIds[0]).links[0])
      .toMatchObject({ yawDeg: 90, pitchDeg: 0, positionMode: 'auto' });
    expect(manifest.body.scenes.find((scene: { id: string }) => scene.id === sceneIds[1]).links[0])
      .toMatchObject({ yawDeg: 270, pitchDeg: 0, positionMode: 'auto' });

    const manual = await client.patch(`/api/tours/${tourId}/links/${westToEast.id}`).set(auth)
      .send({ yawDeg: 33, pitchDeg: 25, expectedVersion: added.body.tour.version });
    expect(manual.status).toBe(200);
    const moved = await client.patch(`/api/tours/${tourId}/placements/${placementIds[1]}`).set(auth)
      .send({ x: 100, y: 300, expectedVersion: manual.body.tour.version });
    expect(moved.status).toBe(200);
    const afterMove = await client.get(`/api/tours/${tourId}/viewer-manifest`).set(auth);
    expect(afterMove.body.scenes.find((scene: { id: string }) => scene.id === sceneIds[0]).links[0])
      .toMatchObject({ yawDeg: 33, pitchDeg: 25, positionMode: 'manual' });
    expect(afterMove.body.scenes.find((scene: { id: string }) => scene.id === sceneIds[1]).links[0])
      .toMatchObject({ yawDeg: 0, pitchDeg: 0, positionMode: 'auto' });
    const reset = await client.post(`/api/tours/${tourId}/links/${westToEast.id}/reset-to-plan`).set(auth)
      .send({ expectedVersion: moved.body.tour.version });
    expect(reset.body.links.find((link: { id: string }) => link.id === westToEast.id))
      .toMatchObject({ positionMode: 'auto', manualYawDeg: null, manualPitchDeg: null });
    const removedDirection = await client.delete(`${path}/directions/${eastToWest.id}`).set(auth)
      .send({ expectedVersion: reset.body.tour.version });
    expect(removedDirection.body.connections).toHaveLength(1);
    expect(removedDirection.body.links).toHaveLength(1);
    const independent = await client.post(`/api/tours/${tourId}/links`).set(auth)
      .send({ sourceSceneId: sceneIds[0], targetSceneId: sceneIds[1], yawDeg: 50, pitchDeg: 10,
        expectedVersion: removedDirection.body.tour.version });
    expect(independent.status).toBe(201);
    const removed = await client.delete(`${path}/${connectionId}`).set(auth)
      .send({ expectedVersion: independent.body.tour.version });
    expect(removed.body.connections).toHaveLength(0);
    expect(removed.body.links).toHaveLength(1);
    expect(removed.body.links[0]).toMatchObject({ planConnectionId: null, positionMode: 'manual' });
    const removedManual = await client.delete(`/api/tours/${tourId}/links/${removed.body.links[0].id}`).set(auth)
      .send({ expectedVersion: removed.body.tour.version });
    expect(removedManual.status).toBe(200);
    expect(removedManual.body.links).toHaveLength(0);
    const start = await client.patch(`/api/tours/${tourId}`).set(auth)
      .send({ entrySceneId: sceneIds[1], expectedVersion: removedManual.body.tour.version });
    expect(start.status).toBe(200);
    expect(start.body.tour.entrySceneId).toBe(sceneIds[1]);
    const reopened = await client.get(`/api/tours/${tourId}/viewer-manifest`).set(auth);
    expect(reopened.body.entrySceneId).toBe(sceneIds[1]);
  });

  it('deletes a photo and every graph reference while keeping the other scene', async () => {
    const { client, storage } = fixture();
    const auth = { Authorization: 'Bearer alice' };
    const created = await client.post('/api/tours').set(auth).send({ title: 'Rooms' });
    const tourId = created.body.tour.id as string;
    const pageId = created.body.pages[0].id as string;
    const bytes = await image(1024, 512, 'green');
    const sceneIds: string[] = [];
    const assetIds: string[] = [];
    const placementIds: string[] = [];
    let version = created.body.tour.version as number;
    for (const [index, name] of ['Hall', 'Kitchen'].entries()) {
      const upload = await client.post(`/api/tours/${tourId}/uploads`).set(auth)
        .send({ fileName: `${name}.png`, mimeType: 'image/png', byteSize: bytes.length });
      const assetId = upload.body.asset.id as string;
      assetIds.push(assetId);
      storage.objects.set(`tours/${tourId}/panoramas/${assetId}`, { bytes, mimeType: 'image/png' });
      const ready = await client.post(`/api/tours/${tourId}/uploads/${assetId}/complete`).set(auth);
      const sceneId = ready.body.sceneId as string;
      sceneIds.push(sceneId);
      version = (await client.get(`/api/tours/${tourId}`).set(auth)).body.tour.version;
      const placed = await client.post(`/api/tours/${tourId}/placements`).set(auth)
        .send({ pageId, sceneId, x: 100 + 200 * index, y: 100, expectedVersion: version });
      placementIds.push(placed.body.placements.find((item: { sceneId: string }) => item.sceneId === sceneId).id);
      version = placed.body.tour.version;
    }
    const connection = await client.post(`/api/tours/${tourId}/connections`).set(auth)
      .send({ placementAId: placementIds[0], placementBId: placementIds[1], expectedVersion: version });
    const manual = await client.post(`/api/tours/${tourId}/links`).set(auth)
      .send({ sourceSceneId: sceneIds[1], targetSceneId: sceneIds[0], yawDeg: 20, pitchDeg: 5,
        expectedVersion: connection.body.tour.version });
    const start = await client.patch(`/api/tours/${tourId}`).set(auth)
      .send({ entrySceneId: sceneIds[0], expectedVersion: manual.body.tour.version });
    const pending = await client.post(`/api/tours/${tourId}/uploads`).set(auth)
      .send({ fileName: 'hall.jpeg', mimeType: 'image/png', byteSize: bytes.length });
    const pendingId = pending.body.asset.id as string;
    storage.objects.set(`tours/${tourId}/panoramas/${pendingId}`, { bytes, mimeType: 'image/png' });
    const path = `/api/tours/${tourId}/scenes/${sceneIds[0]}`;
    expect((await client.delete(path).set('Authorization', 'Bearer bob')
      .send({ expectedVersion: start.body.tour.version })).status).toBe(404);
    expect((await client.delete(path).set(auth)
      .send({ expectedVersion: version })).status).toBe(409);
    const pendingDelete = await client.delete(path).set(auth)
      .send({ expectedVersion: start.body.tour.version });
    expect(pendingDelete.status).toBe(409);
    expect(pendingDelete.body.error.code).toBe('UPLOAD_IN_PROGRESS');
    const canceled = await client.delete(`/api/tours/${tourId}/uploads/${pendingId}`).set(auth);
    expect(canceled.status).toBe(204);
    const deleted = await client.delete(path).set(auth).send({ expectedVersion: start.body.tour.version });
    expect(deleted.status).toBe(200);
    expect(deleted.body.tour.entrySceneId).toBeNull();
    expect(deleted.body.scenes.map((scene: { id: string }) => scene.id)).toEqual([sceneIds[1]]);
    expect(deleted.body.placements.map((placement: { id: string }) => placement.id)).toEqual([placementIds[1]]);
    expect(deleted.body.connections).toEqual([]);
    expect(deleted.body.links).toEqual([]);
    expect(deleted.body.assets.map((asset: { id: string }) => asset.id)).toEqual([assetIds[1]]);
    expect(storage.deleted).toEqual(expect.arrayContaining([
      `tours/${tourId}/panoramas/${assetIds[0]}`,
      `tours/${tourId}/thumbnails/${assetIds[0]}.jpg`,
      `tours/${tourId}/panoramas/${pendingId}`
    ]));
    const manifest = await client.get(`/api/tours/${tourId}/viewer-manifest`).set(auth);
    expect(manifest.body.entrySceneId).toBe(sceneIds[1]);
    expect(manifest.body.scenes).toHaveLength(1);
  });
});
