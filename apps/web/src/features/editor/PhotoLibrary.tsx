import type { PanoramaAsset, Scene } from '@pano/domain';
import { Link } from 'react-router-dom';
import { PhotoCards, readyPhotoCards } from '../tours/PhotoCards';

export function PhotoLibrary({ tourId, assets, scenes, placedSceneIds, selectedSceneId,
  selectedNodeSceneId, outgoingSceneIds, unreachableNodeLabels, startSceneLabel, onSelect }: {
  tourId: string; assets: PanoramaAsset[]; scenes: Scene[]; placedSceneIds: ReadonlySet<string>;
  selectedSceneId: string | null; selectedNodeSceneId: string | null; outgoingSceneIds: ReadonlySet<string>;
  unreachableNodeLabels: string[]; startSceneLabel: string;
  onSelect: (sceneId: string | null) => void;
}) {
  const readyCards = readyPhotoCards(assets, scenes);
  const warnings = new Map<string, 'Unplaced' | 'Isolated'>();
  let unplacedCount = 0;
  let isolatedCount = 0;
  for (const card of readyCards) {
    if (!card.sceneId) continue;
    if (!placedSceneIds.has(card.sceneId)) { warnings.set(card.sceneId, 'Unplaced'); unplacedCount++; }
    else if (!outgoingSceneIds.has(card.sceneId)) { warnings.set(card.sceneId, 'Isolated'); isolatedCount++; }
  }
  const warningCount = unreachableNodeLabels.length + unplacedCount + isolatedCount;

  return <div className="photo-library">
    {warningCount > 0 && <details className="photo-warnings">
      <summary>Warnings: {warningCount}</summary>
      {unreachableNodeLabels.length > 0 && <div className="photo-warning-summary">
        <strong>Not all nodes are reachable</strong>
        <span>{unreachableNodeLabels.length} placed {unreachableNodeLabels.length === 1 ? 'node is' : 'nodes are'} unreachable from {startSceneLabel}.</span>
        <small>{unreachableNodeLabels.slice(0, 3).join(', ')}{unreachableNodeLabels.length > 3 ? `, and ${unreachableNodeLabels.length - 3} more` : ''}</small>
      </div>}
      {(unplacedCount > 0 || isolatedCount > 0) && <div className="photo-warning-summary">
        <strong>Needs attention</strong>
        <span>{unplacedCount} unplaced · {isolatedCount} isolated</span>
        <small>Unplaced photos have no canvas node. Isolated nodes have no outgoing links.</small>
      </div>}
    </details>}
    {readyCards.length > 0 ? <PhotoCards tourId={tourId} cards={readyCards}
      selectedSceneId={selectedSceneId} selectedNodeSceneId={selectedNodeSceneId}
      onSelect={onSelect} warningBySceneId={warnings} /> :
      <div className="photo-library-empty">
        <p>Go to the manage page to upload panoramas</p>
        <Link className="button button--secondary" to={`/tours/${tourId}/manage`}>Open Manage</Link>
      </div>}
  </div>;
}
