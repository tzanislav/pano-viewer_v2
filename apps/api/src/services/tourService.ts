import type { Tour, TourEditorData } from '@pano/domain';
import { normalize360 } from '@pano/domain';
import { TourRepository } from '../repositories/tourRepository.js';

/** Tour rules and owner-scoped commands exposed to HTTP routes. */
export class TourService {
  constructor(private readonly repository: TourRepository) {}

  list(ownerUid: string): Tour[] { return this.repository.list(ownerUid); }
  get(ownerUid: string, tourId: string): TourEditorData { return this.repository.get(ownerUid, tourId); }
  create(ownerUid: string, title: string): TourEditorData { return this.repository.create(ownerUid, title); }

  updateTour(ownerUid: string, tourId: string, input: {
    expectedVersion: number; title?: string; defaultNorthYawDeg?: number; entrySceneId?: string | null;
  }): TourEditorData {
    return this.repository.updateTour(ownerUid, tourId, {
      ...input,
      defaultNorthYawDeg: input.defaultNorthYawDeg === undefined ? undefined : normalize360(input.defaultNorthYawDeg)
    });
  }

  createPage(ownerUid: string, tourId: string, name: string, expectedVersion: number): TourEditorData {
    return this.repository.createPage(ownerUid, tourId, name, expectedVersion);
  }

  updatePage(ownerUid: string, tourId: string, pageId: string, input: {
    expectedVersion: number; name?: string; northAngleDeg?: number;
  }): TourEditorData {
    return this.repository.updatePage(ownerUid, tourId, pageId, {
      ...input,
      northAngleDeg: input.northAngleDeg === undefined ? undefined : normalize360(input.northAngleDeg)
    });
  }

  deletePage(ownerUid: string, tourId: string, pageId: string, expectedVersion: number): TourEditorData {
    return this.repository.deletePage(ownerUid, tourId, pageId, expectedVersion);
  }

  createPlacement(ownerUid: string, tourId: string, input: {
    pageId: string; sceneId: string; x: number; y: number; expectedVersion: number;
  }): TourEditorData { return this.repository.createPlacement(ownerUid, tourId, input); }

  updatePlacement(ownerUid: string, tourId: string, placementId: string, input: {
    x: number; y: number; expectedVersion: number;
  }): TourEditorData { return this.repository.updatePlacement(ownerUid, tourId, placementId, input); }

  deletePlacement(ownerUid: string, tourId: string, placementId: string, expectedVersion: number): TourEditorData {
    return this.repository.deletePlacement(ownerUid, tourId, placementId, expectedVersion);
  }
}
