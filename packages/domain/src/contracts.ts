import { z } from 'zod';

const name = z.string().trim().min(1).max(120);
export const createTourInput = z.object({ title: name }).strict();
export const updateTourInput = z.object({
  expectedVersion: z.number().int().positive(),
  title: name.optional(),
  defaultNorthYawDeg: z.number().finite().optional(),
  entrySceneId: z.string().uuid().nullable().optional()
}).strict().refine((value) => value.title !== undefined || value.defaultNorthYawDeg !== undefined || value.entrySceneId !== undefined);
export const createPageInput = z.object({ name, expectedVersion: z.number().int().positive() }).strict();
export const updatePageInput = z.object({
  expectedVersion: z.number().int().positive(),
  name: name.optional(),
  northAngleDeg: z.number().finite().optional()
}).strict().refine((value) => value.name !== undefined || value.northAngleDeg !== undefined);
export const deletePageInput = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const reservePanoramaInput = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteSize: z.number().int().positive()
}).strict();

export interface Tour {
  id: string;
  title: string;
  entrySceneId: string | null;
  defaultNorthYawDeg: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Page {
  id: string;
  tourId: string;
  name: string;
  sortOrder: number;
  northAngleDeg: number;
  planAssetId: string | null;
}

export interface Scene {
  id: string;
  tourId: string;
  panoramaAssetId: string;
  name: string;
  sortOrder: number;
  northYawOverrideDeg: number | null;
}

export interface Placement {
  id: string;
  tourId: string;
  pageId: string;
  sceneId: string;
  x: number;
  y: number;
}

export interface PlanConnection {
  id: string;
  tourId: string;
  placementAId: string;
  placementBId: string;
}

export interface NavigationLink {
  id: string;
  tourId: string;
  sourceSceneId: string;
  targetSceneId: string;
  planConnectionId: string | null;
  positionMode: 'auto' | 'manual';
  manualYawDeg: number | null;
  manualPitchDeg: number | null;
}

export interface PanoramaAsset {
  id: string;
  tourId: string;
  fileName: string;
  filenameKey: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  errorCode: string | null;
  thumbnailReady: boolean;
  replacesSceneId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TourEditorData {
  tour: Tour;
  pages: Page[];
  scenes: Scene[];
  placements: Placement[];
  connections: PlanConnection[];
  links: NavigationLink[];
  assets: PanoramaAsset[];
}
