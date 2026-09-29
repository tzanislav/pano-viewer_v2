import { useEffect, useState } from 'react';
import { photoNameStem, sceneDisplayNumbers, type PanoramaAsset, type Scene } from '@pano/domain';
import { tourApi } from './tourApi';

interface PhotoCard {
  asset: PanoramaAsset;
  sceneId: string | null;
  number: number;
}

export function readyPhotoCards(assets: PanoramaAsset[], scenes: Scene[]): PhotoCard[] {
  const sceneNumbers = sceneDisplayNumbers(scenes);
  return assets.filter(asset => asset.status === 'ready').map((asset, index) => {
    const scene = scenes.find(candidate => candidate.panoramaAssetId === asset.id);
    return { asset, sceneId: scene?.id ?? null,
      number: scene ? sceneNumbers.get(scene.id) ?? scenes.length + index + 1 : scenes.length + index + 1 };
  }).sort((a, b) => a.number - b.number);
}

export function PhotoCards({ tourId, cards, selectedSceneId, onSelect, disabledSceneIds,
  selectedNodeSceneId = null, disabledLabel = 'Placed', thumbnailUrls, label = 'Uploaded panoramas',
  warningBySceneId }: {
  tourId: string;
  cards: PhotoCard[];
  selectedSceneId: string | null;
  selectedNodeSceneId?: string | null;
  onSelect: (sceneId: string | null) => void;
  disabledSceneIds?: ReadonlySet<string>;
  disabledLabel?: string;
  warningBySceneId?: ReadonlyMap<string, 'Unplaced' | 'Isolated'>;
  thumbnailUrls?: ReadonlyMap<string, string>;
  label?: string;
}) {
  return <ol className="photo-list photo-ready-list" aria-label={label}>{cards.map(({ asset, sceneId, number }) => {
    const disabled = !sceneId || !!disabledSceneIds?.has(sceneId);
    const name = photoNameStem(asset.fileName);
    const warning = sceneId ? warningBySceneId?.get(sceneId) : undefined;
    const thumbnailUrl = sceneId ? thumbnailUrls?.get(sceneId) : undefined;
    return <li className="photo-card" key={asset.id}
      data-selected={sceneId !== null && (selectedSceneId === sceneId || selectedNodeSceneId === sceneId) || undefined}
      data-node-selected={sceneId !== null && selectedNodeSceneId === sceneId || undefined}
      aria-current={sceneId !== null && selectedNodeSceneId === sceneId ? 'true' : undefined}>
      <button className="photo-card-action" type="button" disabled={disabled}
        aria-pressed={sceneId !== null && selectedSceneId === sceneId}
        aria-label={`${name}, photo ${number}${warning ? `, ${warning.toLowerCase()}` : ''}${disabled && sceneId ? `, ${disabledLabel.toLowerCase()}` : ''}`}
        onClick={() => { if (sceneId) onSelect(selectedSceneId === sceneId ? null : sceneId); }}>
        {thumbnailUrl ? <img className="photo-thumb" src={thumbnailUrl} alt="" />
          : <PhotoThumbnail tourId={tourId} assetId={asset.id} />}
        <span className="photo-card-number" aria-hidden="true">{number}</span>
        <strong className="photo-card-name" title={name}>{name}</strong>
        {warning && <span className="photo-card-warning">{warning}</span>}
        {disabled && sceneId && <span className="photo-card-placed">{disabledLabel}</span>}
      </button>
    </li>;
  })}</ol>;
}

export function PhotoThumbnail({ tourId, assetId }: { tourId: string; assetId: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const result = await tourApi.thumbnailUrl(tourId, assetId);
        if (!active) return;
        setUrl(result.url);
        timer = setTimeout(() => void load(), Math.max(30, result.expiresIn - 60) * 1000);
      } catch { if (active) setUrl(''); }
    }
    void load();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [tourId, assetId]);
  return url ? <img className="photo-thumb" src={url} alt="" /> : <div className="photo-thumb photo-thumb--empty" aria-hidden="true" />;
}
