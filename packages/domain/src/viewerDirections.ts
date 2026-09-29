import type { NavigationLink, TourEditorData, ViewerLink } from './contracts.js';
import { normalize360, planBearing } from './geometry.js';

/** Resolve a directed hotspot to the source photo's spherical coordinates. */
export function resolveViewerLink(link: NavigationLink, data: TourEditorData): ViewerLink | null {
  if (link.positionMode === 'manual') {
    if (link.manualYawDeg === null || link.manualPitchDeg === null) return null;
    return { id: link.id, targetSceneId: link.targetSceneId,
      yawDeg: normalize360(link.manualYawDeg), pitchDeg: link.manualPitchDeg, positionMode: 'manual' };
  }
  const source = data.placements.find(placement => placement.sceneId === link.sourceSceneId);
  const target = data.placements.find(placement => placement.sceneId === link.targetSceneId);
  if (!source || !target || source.pageId !== target.pageId) return null;
  const page = data.pages.find(item => item.id === source.pageId);
  const scene = data.scenes.find(item => item.id === source.sceneId);
  if (!page || !scene) return null;
  try {
    const heading = planBearing(source, target, page.northAngleDeg);
    return { id: link.id, targetSceneId: link.targetSceneId,
      yawDeg: normalize360((scene.northYawOverrideDeg ?? data.tour.defaultNorthYawDeg) + heading),
      pitchDeg: 0, positionMode: 'auto' };
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
