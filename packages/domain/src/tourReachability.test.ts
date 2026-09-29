import { describe, expect, it } from 'vitest';
import type { NavigationLink, TourEditorData } from './contracts.js';
import { checkPlacedNodeReachability, readyViewerScenes, viewerStartSceneId } from './tourReachability.js';

const manual = (id: string, sourceSceneId: string, targetSceneId: string): NavigationLink => ({
  id, tourId: 'tour', sourceSceneId, targetSceneId, planConnectionId: null,
  positionMode: 'manual', manualYawDeg: 90, manualPitchDeg: 0
});

function tour(): TourEditorData {
  const scenes = ['A', 'B', 'C', 'U'].map((id, sortOrder) => ({
    id, tourId: 'tour', panoramaAssetId: `asset-${id}`, name: id,
    sortOrder, northYawOverrideDeg: null
  }));
  const assets = scenes.map(scene => ({
    id: scene.panoramaAssetId, tourId: 'tour', fileName: `${scene.name}.jpg`,
    filenameKey: scene.name.toLowerCase(), mimeType: 'image/jpeg', byteSize: 100,
    width: 1024, height: 512, status: 'ready' as const, errorCode: null,
    thumbnailReady: true, replacesSceneId: null, createdAt: '', updatedAt: ''
  }));
  return {
    tour: { id: 'tour', title: 'Test', entrySceneId: 'A', defaultNorthYawDeg: 0,
      version: 1, createdAt: '', updatedAt: '' },
    pages: [{ id: 'page', tourId: 'tour', name: 'Ground', sortOrder: 0,
      northAngleDeg: 0, planAssetId: null }],
    scenes, assets, underlays: [], connections: [],
    placements: [
      { id: 'a', tourId: 'tour', pageId: 'page', sceneId: 'A', x: 100, y: 100 },
      { id: 'b', tourId: 'tour', pageId: 'page', sceneId: 'B', x: 300, y: 100 },
      { id: 'c', tourId: 'tour', pageId: 'page', sceneId: 'C', x: 500, y: 100 }
    ],
    links: [
      { ...manual('a-b', 'A', 'B'), planConnectionId: 'connection',
        positionMode: 'auto', manualYawDeg: null, manualPitchDeg: null },
      { ...manual('b-a', 'B', 'A'), planConnectionId: 'connection',
        positionMode: 'auto', manualYawDeg: null, manualPitchDeg: null }
    ]
  };
}

describe('placed node reachability', () => {
  it('updates when directed plan or manual links are added or removed', () => {
    const data = tour();
    expect(checkPlacedNodeReachability(data).unreachableSceneIds).toEqual(['C']);
    data.links.push(manual('c-b', 'C', 'B'));
    expect(checkPlacedNodeReachability(data).unreachableSceneIds).toEqual(['C']);
    data.links.push(manual('b-c', 'B', 'C'));
    expect(checkPlacedNodeReachability(data).unreachableSceneIds).toEqual([]);
    data.links = data.links.filter(link => link.id !== 'b-c');
    expect(checkPlacedNodeReachability(data).unreachableSceneIds).toEqual(['C']);
    const removedPlacement = data.placements.pop()!;
    expect(checkPlacedNodeReachability(data).unreachableSceneIds).toEqual([]);
    data.placements.push(removedPlacement);
    expect(checkPlacedNodeReachability(data).unreachableSceneIds).toEqual(['C']);
  });

  it('follows manual links through unplaced scenes', () => {
    const data = tour();
    data.links.push(manual('a-u', 'A', 'U'), manual('u-c', 'U', 'C'));
    expect(checkPlacedNodeReachability(data).unreachableSceneIds).toEqual([]);
    data.links = data.links.filter(link => link.id !== 'a-u');
    expect(checkPlacedNodeReachability(data).unreachableSceneIds).toEqual(['C']);
  });

  it('uses the viewer fallback start and ignores links the viewer cannot render', () => {
    const data = tour();
    data.tour.entrySceneId = null;
    data.scenes.find(scene => scene.id === 'U')!.sortOrder = -1;
    expect(readyViewerScenes(data).map(scene => scene.id)).toEqual(['A', 'B', 'C', 'U']);
    expect(viewerStartSceneId(data, readyViewerScenes(data))).toBe('A');
    data.placements[1].x = data.placements[0].x;
    data.placements[1].y = data.placements[0].y;
    expect(checkPlacedNodeReachability(data).unreachableSceneIds).toEqual(['B', 'C']);
  });
});
