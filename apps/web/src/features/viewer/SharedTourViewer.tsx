import { useEffect, useState } from 'react';
import type { ViewerManifest } from '@pano/domain';
import { useParams } from 'react-router-dom';
import { errorMessage } from '../../app/apiClient';
import { tourApi } from '../tours/tourApi';
import { PanoramaStage } from './PanoramaStage';
import { ViewerTray } from './ViewerTray';

export function SharedTourViewer() {
  const { token = '' } = useParams();
  const [manifest, setManifest] = useState<ViewerManifest | null>(null);
  const [activeSceneId, setActiveSceneId] = useState('');
  const [requestedSceneId, setRequestedSceneId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setManifest(null); setError('');
    void tourApi.sharedViewerManifest(token).then(result => {
      if (!active) return;
      setManifest(result);
      setActiveSceneId(result.entrySceneId || result.scenes[0]?.id || '');
    }).catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!manifest) return;
    const delay = Math.max(1_000, Date.parse(manifest.expiresAt) - Date.now() - 60_000);
    const timer = window.setTimeout(() => {
      void tourApi.sharedViewerManifest(token).then(result => {
        setManifest(result);
        setActiveSceneId(current => result.scenes.some(scene => scene.id === current)
          ? current : result.entrySceneId || result.scenes[0]?.id || '');
      }).catch(cause => { setManifest(null); setError(errorMessage(cause)); });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [manifest, token]);

  const current = manifest?.scenes.find(scene => scene.id === activeSceneId);
  return <main className="viewer-page shared-viewer-page">
    <div className="viewer-heading">
      <div><p className="eyebrow">Walkthrough</p><h1>{manifest?.title || 'Shared walkthrough'}</h1></div>
    </div>
    {error && <p className="status viewer-message" data-tone="error" role="alert">{error}</p>}
    {!manifest ? <div className="viewer-empty" role="status"><p>{error ? 'This share link is unavailable.' : 'Loading viewer…'}</p></div>
      : !manifest.scenes.length ? <div className="viewer-empty" role="status"><h2>No panoramas yet</h2>
        <p>This walkthrough has no ready photos.</p></div>
        : <div className="viewer-layout"><div className="viewer-main">
          <div className="viewer-scene-label"><strong>{current?.name || 'Loading panorama…'}</strong>
            <span>{current?.pageName || 'Unplaced'}</span></div>
          <PanoramaStage key={token} manifest={manifest} activeSceneId={activeSceneId}
            requestedSceneId={requestedSceneId} editMode={false} selectedLinkId={null}
            onSceneChange={id => { setActiveSceneId(id); setRequestedSceneId(null); }}
            onSelectLink={() => {}} onClick={() => {}} onCommitLink={() => {}}
            onError={setError} />
          <ViewerTray scenes={manifest.scenes} activeSceneId={activeSceneId}
            onSelectScene={setRequestedSceneId} autoCollapseMs={500} />
        </div></div>}
  </main>;
}
