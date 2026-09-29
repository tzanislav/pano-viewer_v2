import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { ZodError } from 'zod';
import { createPageInput, createPlacementInput, createTourInput, deletePageInput, deletePlacementInput,
  reservePanoramaInput, reserveUnderlayInput, updatePageInput, updatePlacementInput, updateTourInput } from '@pano/domain';
import type { VerifyToken } from './auth/firebaseAdmin.js';
import { AppError } from './errors.js';
import { log } from './logging.js';
import { TourService } from './services/tourService.js';
import { MediaService } from './services/mediaService.js';
import { UnderlayService } from './services/underlayService.js';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    ownerUid: string;
  }
}

export function createApp(tours: TourService, media: MediaService, underlays: UnderlayService,
  verifyToken: VerifyToken, webOrigin: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });
  app.use(cors({ origin: webOrigin }));
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

  const authenticate: RequestHandler = async (req, _res, next) => {
    const match = /^Bearer (\S+)$/i.exec(req.header('authorization') || '');
    if (!match) return next(new AppError(401, 'UNAUTHENTICATED', 'Sign in is required'));
    try {
      req.ownerUid = await verifyToken(match[1]);
      next();
    } catch {
      next(new AppError(401, 'UNAUTHENTICATED', 'Your session is invalid or expired'));
    }
  };
  app.use('/api', authenticate);

  app.get('/api/tours', (req, res) => {
    res.json({ tours: tours.list(req.ownerUid) });
  });
  app.post('/api/tours', (req, res) => {
    const { title } = createTourInput.parse(req.body);
    const data = tours.create(req.ownerUid, title);
    log('info', 'tour.create', { requestId: req.requestId, outcome: 'success', tourId: data.tour.id });
    res.status(201).json(data);
  });
  app.get('/api/tours/:id', (req, res) => {
    res.json(tours.get(req.ownerUid, req.params.id));
  });
  app.patch('/api/tours/:id', (req, res) => {
    const input = updateTourInput.parse(req.body);
    const data = tours.updateTour(req.ownerUid, req.params.id, input);
    log('info', 'tour.update', { requestId: req.requestId, outcome: 'success', tourId: data.tour.id });
    res.json(data);
  });
  app.post('/api/tours/:id/pages', (req, res) => {
    const input = createPageInput.parse(req.body);
    const data = tours.createPage(req.ownerUid, req.params.id, input.name, input.expectedVersion);
    log('info', 'page.create', { requestId: req.requestId, outcome: 'success', tourId: data.tour.id });
    res.status(201).json(data);
  });
  app.patch('/api/tours/:id/pages/:pageId', (req, res) => {
    const input = updatePageInput.parse(req.body);
    const data = tours.updatePage(req.ownerUid, req.params.id, req.params.pageId, input);
    log('info', 'page.update', { requestId: req.requestId, outcome: 'success', tourId: data.tour.id });
    res.json(data);
  });
  app.delete('/api/tours/:id/pages/:pageId', async (req, res) => {
    const { expectedVersion } = deletePageInput.parse(req.body);
    const data = tours.deletePage(req.ownerUid, req.params.id, req.params.pageId, expectedVersion);
    await media.cleanupRetired();
    log('info', 'page.delete', { requestId: req.requestId, outcome: 'success', tourId: data.tour.id, pageId: req.params.pageId });
    res.json(data);
  });
  app.post('/api/tours/:id/placements', (req, res) => {
    const input = createPlacementInput.parse(req.body);
    const data = tours.createPlacement(req.ownerUid, req.params.id, input);
    log('info', 'placement.create', { requestId: req.requestId, outcome: 'success', tourId: req.params.id, sceneId: input.sceneId });
    res.status(201).json(data);
  });
  app.patch('/api/tours/:id/placements/:placementId', (req, res) => {
    const input = updatePlacementInput.parse(req.body);
    const data = tours.updatePlacement(req.ownerUid, req.params.id, req.params.placementId, input);
    log('info', 'placement.update', { requestId: req.requestId, outcome: 'success', tourId: req.params.id, placementId: req.params.placementId });
    res.json(data);
  });
  app.delete('/api/tours/:id/placements/:placementId', (req, res) => {
    const { expectedVersion } = deletePlacementInput.parse(req.body);
    const data = tours.deletePlacement(req.ownerUid, req.params.id, req.params.placementId, expectedVersion);
    log('info', 'placement.delete', { requestId: req.requestId, outcome: 'success', tourId: req.params.id, placementId: req.params.placementId });
    res.json(data);
  });
  app.post('/api/tours/:id/pages/:pageId/underlay/uploads', async (req, res) => {
    const input = reserveUnderlayInput.parse(req.body);
    const result = await underlays.reserve(req.ownerUid, req.params.id, req.params.pageId, input);
    await media.cleanupRetired();
    log('info', 'underlay.reserve', { requestId: req.requestId, outcome: 'success', tourId: req.params.id, pageId: req.params.pageId, assetId: result.upload.id });
    res.status(201).json(result);
  });
  app.post('/api/tours/:id/pages/:pageId/underlay/uploads/:assetId/complete', async (req, res) => {
    const result = await underlays.complete(req.ownerUid, req.params.id, req.params.pageId, req.params.assetId);
    log('info', 'underlay.complete', { requestId: req.requestId, outcome: 'success', tourId: req.params.id, pageId: req.params.pageId, assetId: req.params.assetId });
    res.json({ upload: result });
  });
  app.delete('/api/tours/:id/pages/:pageId/underlay/uploads/:assetId', async (req, res) => {
    await underlays.cancel(req.ownerUid, req.params.id, req.params.pageId, req.params.assetId);
    res.status(204).end();
  });
  app.get('/api/tours/:id/pages/:pageId/underlay-url', async (req, res) => {
    res.json(await underlays.readUrl(req.ownerUid, req.params.id, req.params.pageId));
  });
  app.delete('/api/tours/:id/pages/:pageId/underlay', async (req, res) => {
    const { expectedVersion } = deletePageInput.parse(req.body);
    await underlays.remove(req.ownerUid, req.params.id, req.params.pageId, expectedVersion);
    await media.cleanupRetired();
    log('info', 'underlay.remove', { requestId: req.requestId, outcome: 'success', tourId: req.params.id, pageId: req.params.pageId });
    res.json(tours.get(req.ownerUid, req.params.id));
  });
  app.post('/api/tours/:id/uploads', async (req, res) => {
    const input = reservePanoramaInput.parse(req.body);
    const result = await media.reserve(req.ownerUid, req.params.id, input);
    log('info', 'upload.reserve', { requestId: req.requestId, outcome: 'success', tourId: req.params.id, assetId: result.asset.id });
    res.status(201).json(result);
  });
  app.post('/api/tours/:id/uploads/:assetId/complete', async (req, res) => {
    const started = Date.now();
    const result = await media.complete(req.ownerUid, req.params.id, req.params.assetId);
    log('info', 'upload.complete', { requestId: req.requestId, outcome: 'success',
      tourId: req.params.id, assetId: req.params.assetId, durationMs: Date.now() - started });
    res.json(result);
  });
  app.delete('/api/tours/:id/uploads/:assetId', async (req, res) => {
    await media.cancel(req.ownerUid, req.params.id, req.params.assetId);
    log('info', 'upload.cancel', { requestId: req.requestId, outcome: 'success', tourId: req.params.id, assetId: req.params.assetId });
    res.status(204).end();
  });
  app.get('/api/tours/:id/assets/:assetId/thumbnail-url', async (req, res) => {
    res.json(await media.thumbnailUrl(req.ownerUid, req.params.id, req.params.assetId));
  });
  app.get('/api/tours/:id/assets/:assetId/read-url', async (req, res) => {
    res.json(await media.originalUrl(req.ownerUid, req.params.id, req.params.assetId));
  });

  app.use('/api', () => { throw new AppError(404, 'ROUTE_NOT_FOUND', 'API route not found'); });

  const handleError: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    void _next;
    const known = error instanceof AppError ? error : error instanceof ZodError
      ? new AppError(400, 'INVALID_INPUT', 'Check the supplied fields')
      : error instanceof SyntaxError && 'body' in error
        ? new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON')
        : new AppError(500, 'INTERNAL_ERROR', 'Something went wrong');
    log(known.status >= 500 ? 'error' : 'warn', 'api.request', {
      requestId: req.requestId, outcome: 'failure', code: known.code,
      method: req.method, path: req.path
    });
    if (known.status >= 500) console.error(error);
    res.status(known.status).json({ error: { code: known.code, message: known.message, requestId: req.requestId } });
  };
  app.use(handleError);
  return app;
}
