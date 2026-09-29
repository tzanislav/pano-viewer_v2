import type { Scene, TourEditorData } from './contracts.js';
import { resolveViewerLink } from './viewerDirections.js';

/** Ready scenes in the same order used by the viewer tray and default entry. */
export function readyViewerScenes(data: TourEditorData): Scene[] {
  const readyAssets = new Set(data.assets.filter(asset => asset.status === 'ready').map(asset => asset.id));
  const placementByScene = new Map(data.placements.map(placement => [placement.sceneId, placement]));
  const pageById = new Map(data.pages.map(page => [page.id, page]));
  return data.scenes.filter(scene => readyAssets.has(scene.panoramaAssetId)).sort((a, b) => {
    const aPage = pageById.get(placementByScene.get(a.id)?.pageId || '');
    const bPage = pageById.get(placementByScene.get(b.id)?.pageId || '');
    return (aPage?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (bPage?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
  });
}

export function viewerStartSceneId(data: TourEditorData, readyScenes: readonly Scene[]): string | null {
  const requested = data.tour.entrySceneId;
  return requested && readyScenes.some(scene => scene.id === requested) ? requested : readyScenes[0]?.id ?? null;
}

/** Traverse rendered, directed hotspots, including paths through unplaced scenes. */
export function checkPlacedNodeReachability(data: TourEditorData): {
  startSceneId: string | null; unreachableSceneIds: string[];
} {
  const readyScenes = readyViewerScenes(data);
  const startSceneId = viewerStartSceneId(data, readyScenes);
  const available = new Set(readyScenes.map(scene => scene.id));
  const neighbors = new Map<string, Set<string>>();
  for (const link of data.links) {
    if (!available.has(link.sourceSceneId) || !available.has(link.targetSceneId)) continue;
    if (!resolveViewerLink(link, data)) continue;
    if (!neighbors.has(link.sourceSceneId)) neighbors.set(link.sourceSceneId, new Set());
    neighbors.get(link.sourceSceneId)!.add(link.targetSceneId);
  }
  const reached = new Set<string>();
  if (startSceneId) {
    const queue = [startSceneId];
    reached.add(startSceneId);
    for (let index = 0; index < queue.length; index++) {
      for (const target of neighbors.get(queue[index]) || []) {
        if (reached.has(target)) continue;
        reached.add(target);
        queue.push(target);
      }
    }
  }
  return { startSceneId,
    unreachableSceneIds: data.placements.map(placement => placement.sceneId)
      .filter(sceneId => !reached.has(sceneId)) };
}
