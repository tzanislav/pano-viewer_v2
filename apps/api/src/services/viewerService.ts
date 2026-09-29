import { readyViewerScenes, resolveViewerLink, viewerStartSceneId,
  type ViewerManifest, type ViewerScene } from '@pano/domain';
import { MediaService } from './mediaService.js';
import { TourService } from './tourService.js';

export class ViewerService {
  constructor(private readonly tours: TourService, private readonly media: MediaService) {}

  async manifest(ownerUid: string, tourId: string): Promise<ViewerManifest> {
    const data = this.tours.get(ownerUid, tourId);
    const placementByScene = new Map(data.placements.map(placement => [placement.sceneId, placement]));
    const pageById = new Map(data.pages.map(page => [page.id, page]));
    const ordered = readyViewerScenes(data);
    const availableIds = new Set(ordered.map(scene => scene.id));
    const linksBySource = new Map<string, ViewerScene['links']>();
    for (const link of data.links) {
      if (!availableIds.has(link.sourceSceneId) || !availableIds.has(link.targetSceneId)) continue;
      const resolved = resolveViewerLink(link, data);
      if (resolved) linksBySource.set(link.sourceSceneId, [...(linksBySource.get(link.sourceSceneId) || []), resolved]);
    }
    const expiresIn = this.media.readUrlTtlSeconds;
    const scenes = await Promise.all(ordered.map(async scene => {
      const [panorama, thumbnail] = await Promise.all([
        this.media.originalUrl(ownerUid, tourId, scene.panoramaAssetId),
        this.media.thumbnailUrl(ownerUid, tourId, scene.panoramaAssetId)
      ]);
      const page = pageById.get(placementByScene.get(scene.id)?.pageId || '');
      return { id: scene.id, name: scene.name, pageName: page?.name ?? null,
        panoramaUrl: panorama.url, thumbnailUrl: thumbnail.url,
        links: linksBySource.get(scene.id) || [] } satisfies ViewerScene;
    }));
    return { tourId, title: data.tour.title,
      entrySceneId: viewerStartSceneId(data, ordered),
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), scenes };
  }
}
