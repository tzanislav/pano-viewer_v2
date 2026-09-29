import { describe, expect, it } from 'vitest';
import type { NavigationLink, TourEditorData } from './contracts.js';
import { resolveViewerLink } from './viewerDirections.js';

const source = { id: 'source', tourId: 'tour', panoramaAssetId: 'asset-a', name: 'A', sortOrder: 0, northYawOverrideDeg: 30 };
const target = { id: 'target', tourId: 'tour', panoramaAssetId: 'asset-b', name: 'B', sortOrder: 1, northYawOverrideDeg: null };
const link: NavigationLink = { id: 'link', tourId: 'tour', sourceSceneId: 'source', targetSceneId: 'target',
  planConnectionId: 'connection', positionMode: 'auto', manualYawDeg: null, manualPitchDeg: null };

function tour(x: number, y: number): TourEditorData {
  return {
    tour: { id: 'tour', title: 'Test', entrySceneId: null, defaultNorthYawDeg: 10, version: 1,
      createdAt: '', updatedAt: '' },
    pages: [{ id: 'page', tourId: 'tour', name: 'Ground', sortOrder: 0, northAngleDeg: 0, planAssetId: null }],
    scenes: [source, target],
    placements: [
      { id: 'a', tourId: 'tour', pageId: 'page', sceneId: 'source', x: 500, y: 500 },
      { id: 'b', tourId: 'tour', pageId: 'page', sceneId: 'target', x, y }
    ], connections: [], links: [link], assets: [], underlays: []
  };
}

describe('viewer link directions', () => {
  it('maps cardinal plan bearings through the source photo north calibration', () => {
    expect([[500, 400], [600, 500], [500, 600], [400, 500]]
      .map(([x, y]) => resolveViewerLink(link, tour(x, y))?.yawDeg))
      .toEqual([30, 120, 210, 300]);
    const rotated = tour(600, 500);
    rotated.pages[0].northAngleDeg = 90;
    expect(resolveViewerLink(link, rotated)?.yawDeg).toBe(30);
  });

  it('keeps a manual direction after nodes move', () => {
    const manual: NavigationLink = { ...link, positionMode: 'manual', manualYawDeg: -45, manualPitchDeg: 45 };
    expect(resolveViewerLink(manual, tour(400, 500))).toMatchObject({ yawDeg: 315, pitchDeg: 45 });
    expect(resolveViewerLink(manual, tour(600, 500))).toMatchObject({ yawDeg: 315, pitchDeg: 45 });
  });
});
