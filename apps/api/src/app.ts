import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { ZodError } from 'zod';
import { createPageInput, createTourInput, deletePageInput, reservePanoramaInput, updatePageInput, updateTourInput } from '@pano/domain';
import type { VerifyToken } from './auth/firebaseAdmin.js';
import { AppError } from './errors.js';
import { log } from './logging.js';
import { TourService } from './services/tourService.js';
import { MediaService } from './services/mediaService.js';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    ownerUid: string;
  }
}

export function createApp(tours: TourService, media: MediaService, verifyToken: VerifyToken, webOrigin: string) {
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
  app.delete('/api/tours/:id/pages/:pageId', (req, res) => {
    const { expectedVersion } = deletePageInput.parse(req.body);
    const data = tours.deletePage(req.ownerUid, req.params.id, req.params.pageId, expectedVersion);
    log('info', 'page.delete', { requestId: req.requestId, outcome: 'success', tourId: data.tour.id, pageId: req.params.pageId });
    res.json(data);
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
