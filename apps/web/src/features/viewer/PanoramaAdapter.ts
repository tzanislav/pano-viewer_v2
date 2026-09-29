import { Viewer } from '@photo-sphere-viewer/core';
import { VirtualTourPlugin, type VirtualTourNode } from '@photo-sphere-viewer/virtual-tour-plugin';
import type { ViewerManifest, ViewerScene } from '@pano/domain';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/virtual-tour-plugin/index.css';

const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (radiansValue: number) => radiansValue * 180 / Math.PI;

function toNode(scene: ViewerScene): VirtualTourNode {
  return { id: scene.id, panorama: scene.panoramaUrl, name: scene.name,
    thumbnail: scene.thumbnailUrl, links: scene.links.map(link => ({
      nodeId: link.targetSceneId, position: { yaw: `${link.yawDeg}deg`, pitch: `${link.pitchDeg}deg` },
      data: { linkId: link.id }
    })) };
}

export class PanoramaAdapter {
  private readonly viewer: Viewer;
  private readonly tour: VirtualTourPlugin;
  private latestNodes: Map<string, VirtualTourNode>;

  constructor(container: HTMLElement, manifest: ViewerManifest, callbacks: {
    onSceneChange: (sceneId: string) => void;
    onViewChange: () => void;
    onClick: (direction: { yawDeg: number; pitchDeg: number }) => void;
    onError: (message: string) => void;
  }) {
    this.latestNodes = new Map(manifest.scenes.map(scene => [scene.id, toNode(scene)]));
    this.viewer = new Viewer({ container, navbar: ['zoom', 'fullscreen'], keyboard: 'always',
      plugins: [[VirtualTourPlugin, { positionMode: 'manual', renderMode: '2d',
        showLinkTooltip: false, nodes: manifest.scenes.map(toNode), startNodeId: manifest.entrySceneId }]] });
    this.tour = this.viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
    this.tour.addEventListener('node-changed', event => {
      const previous = event.data?.fromNode;
      if (previous && previous.id !== event.node.id) {
        const updated = this.latestNodes.get(previous.id);
        if (updated) this.tour.updateNode(updated);
      }
      callbacks.onSceneChange(event.node.id);
    });
    this.viewer.addEventListener('position-updated', callbacks.onViewChange);
    this.viewer.addEventListener('zoom-updated', callbacks.onViewChange);
    this.viewer.addEventListener('click', event => callbacks.onClick({
      yawDeg: degrees(event.data.yaw), pitchDeg: degrees(event.data.pitch) }));
    this.viewer.addEventListener('panorama-error', () => callbacks.onError('Could not load this panorama. Try another photo or reload.'));
  }

  currentSceneId(): string | null { return this.tour.getCurrentNode()?.id ?? null; }

  async goTo(sceneId: string): Promise<void> {
    await this.tour.setCurrentNode(sceneId);
  }

  refresh(manifest: ViewerManifest): void {
    this.latestNodes = new Map(manifest.scenes.map(scene => [scene.id, toNode(scene)]));
    const active = this.currentSceneId();
    for (const [id, node] of this.latestNodes) {
      if (id === active) this.tour.updateNode({ id, name: node.name, thumbnail: node.thumbnail, links: node.links });
      else this.tour.updateNode(node);
    }
  }

  screenPoint(yawDeg: number, pitchDeg: number): { x: number; y: number } | null {
    const point = { yaw: radians(yawDeg), pitch: radians(pitchDeg) };
    if (!this.viewer.dataHelper.isPointVisible(point)) return null;
    return this.viewer.dataHelper.sphericalCoordsToViewerCoords(point);
  }

  directionAt(clientX: number, clientY: number): { yawDeg: number; pitchDeg: number } {
    const rect = this.viewer.container.getBoundingClientRect();
    const direction = this.viewer.dataHelper.viewerCoordsToSphericalCoords({
      x: clientX - rect.left, y: clientY - rect.top
    });
    return { yawDeg: degrees(direction.yaw), pitchDeg: degrees(direction.pitch) };
  }

  destroy(): void { this.viewer.destroy(); }
}
