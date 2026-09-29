import { useEffect, useState, type FormEvent } from 'react';
import { sceneDisplayNumbers, type TourEditorData, type ViewerManifest } from '@pano/domain';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../../app/apiClient';
import { logAction } from '../../app/logAction';
import { tourApi } from '../tours/tourApi';
import { PhotoCards, readyPhotoCards } from '../tours/PhotoCards';
import { PanoramaStage } from './PanoramaStage';
import { ViewerTray } from './ViewerTray';

interface Direction { yawDeg: number; pitchDeg: number }

export function TourViewer() {
  const { tourId = '' } = useParams();
  const [data, setData] = useState<TourEditorData | null>(null);
  const [manifest, setManifest] = useState<ViewerManifest | null>(null);
  const [activeSceneId, setActiveSceneId] = useState('');
  const [requestedSceneId, setRequestedSceneId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [targetSceneId, setTargetSceneId] = useState('');
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [yawInput, setYawInput] = useState('0');
  const [pitchInput, setPitchInput] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([tourApi.get(tourId), tourApi.viewerManifest(tourId)]).then(([tour, viewer]) => {
      if (!active) return;
      setData(tour); setManifest(viewer); setActiveSceneId(viewer.entrySceneId || '');
    }).catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [tourId]);

  useEffect(() => {
    if (!manifest?.scenes.length) return;
    const delay = Math.max(10_000, Date.parse(manifest.expiresAt) - Date.now() - 60_000);
    const timer = window.setTimeout(() => {
      void tourApi.viewerManifest(tourId).then(setManifest)
        .catch(cause => setError(`Could not refresh photo access: ${errorMessage(cause)}`));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [manifest, tourId]);

  const current = manifest?.scenes.find(scene => scene.id === activeSceneId);
  const sceneNumbers = sceneDisplayNumbers(data?.scenes || []);
  const placedSceneIds = new Set(data?.placements.map(placement => placement.sceneId) || []);
  function sceneLabel(sceneId: string) {
    return `${placedSceneIds.has(sceneId) ? 'Node' : 'Photo'} ${sceneNumbers.get(sceneId) ?? '?'}`;
  }
  const selectedLink = current?.links.find(link => link.id === selectedLinkId);
  const target = manifest?.scenes.find(scene => scene.id === selectedLink?.targetSceneId);

  async function mutate(action: string, operation: () => Promise<TourEditorData>) {
    if (busy) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const updated = await operation();
      setData(updated);
      setManifest(await tourApi.viewerManifest(tourId));
      setStatus('Saved');
      logAction(action, 'success', { tourId, sceneId: activeSceneId });
    } catch (cause) {
      setError(errorMessage(cause));
      logAction(action, 'failure', { tourId, sceneId: activeSceneId });
    } finally { setBusy(false); }
  }

  function selectLink(id: string) {
    const link = current?.links.find(item => item.id === id);
    if (!link) return;
    setTargetSceneId(''); setSelectedLinkId(id);
    setYawInput(String(link.yawDeg)); setPitchInput(String(link.pitchDeg));
  }

  function saveLink(id: string, direction: Direction) {
    if (!data) return;
    void mutate('link.update', () => tourApi.updateViewerLink(tourId, id, {
      ...direction, expectedVersion: data.tour.version
    }));
    setYawInput(String(direction.yawDeg)); setPitchInput(String(direction.pitchDeg));
  }

  function clickSphere(direction: Direction) {
    if (!editMode || !data || busy) return;
    if (targetSceneId) {
      void mutate('link.create', () => tourApi.createViewerLink(tourId, {
        sourceSceneId: activeSceneId, targetSceneId, ...direction, expectedVersion: data.tour.version
      }));
      setTargetSceneId('');
    } else if (selectedLinkId) saveLink(selectedLinkId, direction);
  }

  function submitAngles(event: FormEvent) {
    event.preventDefault();
    if (!selectedLinkId) return;
    const direction = { yawDeg: Number(yawInput), pitchDeg: Number(pitchInput) };
    if (!Number.isFinite(direction.yawDeg) || !Number.isFinite(direction.pitchDeg) || Math.abs(direction.pitchDeg) > 90) {
      setError('Enter a valid azimuth and an elevation from -90° to 90°.'); return;
    }
    saveLink(selectedLinkId, direction);
  }

  return <main className="viewer-page">
    <div className="viewer-heading">
      <div><p className="eyebrow">Viewer mode</p><h1>{manifest?.title || 'Walkthrough'}</h1></div>
      <div className="viewer-heading-actions">
        {manifest?.scenes.length ? <button className="button button--secondary" type="button"
          aria-pressed={editMode} onClick={() => { setEditMode(value => !value); setTargetSceneId(''); setSelectedLinkId(null); }}>
          Edit mode {editMode ? 'on' : 'off'}
        </button> : null}
        <Link className="button button--secondary" to={`/tours/${tourId}`}>Back to editor</Link>
      </div>
    </div>
    {error && <p className="status viewer-message" data-tone="error" role="alert">{error}</p>}
    {status && <p className="status viewer-message" data-tone="success" role="status">{status}</p>}
    {!manifest ? <div className="viewer-empty" role="status"><p>{error ? 'The viewer could not load.' : 'Loading viewer…'}</p></div>
      : !manifest.scenes.length ? <div className="viewer-empty" role="status">
        <h2>No panoramas yet</h2><p>Upload photos in the editor to start this tour.</p>
      </div> : <div className={`viewer-layout${editMode ? ' viewer-layout--editing' : ''}`}>
        {editMode && <aside className="viewer-photo-panel" aria-label="Link destination photos">
          <p className="eyebrow">Photo library</p>
          <h2>Panoramas</h2>
          <p>Choose a destination photo, then click where its link should appear in the panorama.</p>
          {data && <PhotoCards tourId={tourId}
            cards={readyPhotoCards(data.assets, data.scenes).filter(card => card.sceneId && manifest.scenes.some(scene => scene.id === card.sceneId))}
            selectedSceneId={targetSceneId || null}
            onSelect={sceneId => { setTargetSceneId(sceneId || ''); setSelectedLinkId(null); }}
            disabledSceneIds={new Set([activeSceneId])} disabledLabel="Current photo"
            thumbnailUrls={new Map(manifest.scenes.map(scene => [scene.id, scene.thumbnailUrl]))}
            label="Photos available as link destinations" />}
          {targetSceneId && <p className="viewer-editor-hint">Click in the panorama to place this link. Click the photo again to cancel.</p>}
        </aside>}
        <div className="viewer-main">
          <div className="viewer-scene-label"><strong>{current?.name || 'Loading panorama…'}</strong>
            {current?.pageName && <span>{current.pageName}</span>}
          </div>
          <PanoramaStage key={tourId} manifest={manifest} activeSceneId={activeSceneId}
            requestedSceneId={requestedSceneId} editMode={editMode} selectedLinkId={selectedLinkId}
            onSceneChange={id => { setActiveSceneId(id); setRequestedSceneId(null); setSelectedLinkId(null); setTargetSceneId('');
              logAction('viewer.navigate', 'success', { tourId, sceneId: id }); }}
            onSelectLink={selectLink} onClick={clickSphere} onCommitLink={saveLink}
            onError={message => { setError(message); logAction('viewer.navigate', 'failure', { tourId, sceneId: activeSceneId }); }} />
          <ViewerTray scenes={manifest.scenes} activeSceneId={activeSceneId} sceneNumbers={sceneNumbers}
            onSelectScene={sceneId => { setRequestedSceneId(sceneId); setSelectedLinkId(null); }} />
        </div>
        {editMode && <aside className="viewer-editor" aria-label="Link editor">
          <h2>Links from {current ? sceneLabel(current.id) : 'photo'}</h2>
          <p>Select any destination from the photo library. Photos already linked can be selected again.</p>
          <h3>Placed links</h3>
          {current?.links.length ? <ul className="viewer-link-list">{current.links.map(link => {
            const linkedScene = manifest.scenes.find(scene => scene.id === link.targetSceneId);
            return <li key={link.id}><button type="button" aria-pressed={selectedLinkId === link.id}
              onClick={() => selectLink(link.id)}>{linkedScene ? sceneLabel(linkedScene.id) : 'Photo'} · {Math.round(link.yawDeg)}° / {Math.round(link.pitchDeg)}°</button></li>;
          })}</ul> : <p>No links from this photo yet.</p>}
          {selectedLink && <form className="viewer-link-form" onSubmit={submitAngles}>
            <h3>{target ? sceneLabel(target.id) : 'Selected link'}</h3>
            <p>Drag its handle, click a new position in the panorama, or enter angles.</p>
            <label>Azimuth (°)<input type="number" step="any" value={yawInput}
              onChange={event => setYawInput(event.target.value)} /></label>
            <label>Elevation (°)<input type="number" step="any" min="-90" max="90" value={pitchInput}
              onChange={event => setPitchInput(event.target.value)} /></label>
            <button className="button button--secondary" type="submit" disabled={busy}>Save position</button>
            {selectedLink.positionMode === 'manual' && data?.links.find(link => link.id === selectedLink.id)?.planConnectionId &&
              <button className="text-button" type="button" disabled={busy}
                onClick={() => { if (!data) return; void mutate('link.reset', () =>
                  tourApi.resetPlanDirection(tourId, selectedLink.id, data.tour.version)); setSelectedLinkId(null); }}>
                Reset to plan direction
              </button>}
            {selectedLink.positionMode === 'manual' && <button className="text-button text-button--danger" type="button"
              disabled={busy || !!data?.links.find(link => link.id === selectedLink.id)?.planConnectionId}
              onClick={() => { if (!data) return; void mutate('link.delete', () =>
                tourApi.deleteViewerLink(tourId, selectedLink.id, data.tour.version)); setSelectedLinkId(null); }}>
              Delete link
            </button>}
          </form>}
        </aside>}
      </div>}
  </main>;
}
