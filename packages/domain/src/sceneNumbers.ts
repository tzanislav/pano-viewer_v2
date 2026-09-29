import type { Scene } from './contracts.js';

/** One-based, contiguous numbers shared by the photo library and future canvas nodes. */
export function sceneDisplayNumbers(scenes: readonly Pick<Scene, 'id' | 'sortOrder'>[]): Map<string, number> {
  return new Map([...scenes]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((scene, index) => [scene.id, index + 1]));
}
