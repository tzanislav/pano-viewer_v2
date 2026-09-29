import { useEffect, useState, type FormEvent } from 'react';
import { photoNameStem, sceneDisplayNumbers, type PanoramaAsset, type TourEditorData } from '@pano/domain';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../../app/apiClient';
import { useWorkspaceHeader, type SaveState } from '../../app/AppShell';
import { logAction } from '../../app/logAction';
import { PhotoThumbnail } from './PhotoCards';
import { PhotoUploader } from './PhotoUploader';
import { tourApi } from './tourApi';

export function TourManage() {
  const { tourId = '' } = useParams();
  const navigate = useNavigate();
  const setWorkspaceHeader = useWorkspaceHeader();
  const [data, setData] = useState<TourEditorData | null>(null);
  const [title, setTitle] = useState('');
  const [northYaw, setNorthYaw] = useState('0');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmPhotoId, setConfirmPhotoId] = useState<string | null>(null);
  const [confirmTourDelete, setConfirmTourDelete] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState('');

  useEffect(() => {
    let active = true;
    void tourApi.get(tourId).then(result => {
      if (!active) return;
      setData(result);
      setTitle(result.tour.title);
      setNorthYaw(String(result.tour.defaultNorthYawDeg));
    }).catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [tourId]);

  useEffect(() => {
    let active = true;
    setShareToken(null);
    void tourApi.share(tourId).then(result => { if (active) setShareToken(result.token); })
      .catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [tourId]);

  useEffect(() => {
    if (data?.tour.id === tourId) setWorkspaceHeader({ tourId, title: data.tour.title, saveState });
    else setWorkspaceHeader(null);
  }, [data, saveState, setWorkspaceHeader, tourId]);
  useEffect(() => () => setWorkspaceHeader(null), [setWorkspaceHeader]);

  async function refresh() {
    const updated = await tourApi.get(tourId);
    setData(current => current?.tour.id === updated.tour.id && current.tour.version > updated.tour.version
      ? current : updated);
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy) return;
    setBusy(true); setSaveState('saving'); setError('');
    try {
      const updated = await tourApi.update(tourId, {
        title: title.trim(), defaultNorthYawDeg: Number(northYaw), expectedVersion: data.tour.version
      });
      setData(updated);
      setTitle(updated.tour.title);
      setNorthYaw(String(updated.tour.defaultNorthYawDeg));
      setSaveState('saved');
      logAction('tour.update', 'success', { tourId });
    } catch (cause) {
      setError(errorMessage(cause)); setSaveState('error');
      logAction('tour.update', 'failure', { tourId });
    } finally { setBusy(false); }
  }

  async function deletePhoto(asset: PanoramaAsset) {
    if (!data || busy) return;
    const scene = data.scenes.find(item => item.panoramaAssetId === asset.id);
    setBusy(true); setSaveState('saving'); setError('');
    try {
      const updated = scene
        ? await tourApi.deleteScene(tourId, scene.id, data.tour.version)
        : await tourApi.cancelUpload(tourId, asset.id).then(() => tourApi.get(tourId));
      setData(updated);
      setConfirmPhotoId(null);
      setSaveState('saved');
      logAction('scene.delete', 'success', { tourId, assetId: asset.id });
    } catch (cause) {
      setError(errorMessage(cause)); setSaveState('error');
      logAction('scene.delete', 'failure', { tourId, assetId: asset.id });
    } finally { setBusy(false); }
  }

  async function deleteTour() {
    if (!data || busy) return;
    setBusy(true); setSaveState('saving'); setError('');
    try {
      await tourApi.delete(tourId, data.tour.version);
      logAction('tour.delete', 'success', { tourId });
      navigate('/', { replace: true });
    } catch (cause) {
      setError(errorMessage(cause)); setSaveState('error'); setBusy(false);
      logAction('tour.delete', 'failure', { tourId });
    }
  }

  async function createShare() {
    if (shareBusy) return;
    setShareBusy(true); setError(''); setShareStatus('');
    try {
      const result = await tourApi.createShare(tourId);
      setShareToken(result.token);
      setShareStatus('Share link is ready.');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setShareBusy(false); }
  }

  async function revokeShare() {
    if (shareBusy) return;
    setShareBusy(true); setError(''); setShareStatus('');
    try {
      await tourApi.revokeShare(tourId);
      setShareToken(null);
      setShareStatus('Share link revoked.');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setShareBusy(false); }
  }

  async function copyShare(url: string) {
    try { await navigator.clipboard.writeText(url); setShareStatus('Link copied.'); }
    catch { setError('Could not copy the link. Select the URL and copy it manually.'); }
  }

  if (!data || data.tour.id !== tourId) return <main className="page-wrap">
    <p className="status" data-tone={error ? 'error' : undefined}>{error || 'Loading project…'}</p>
  </main>;

  const numbers = sceneDisplayNumbers(data.scenes);
  const readyAssets = data.assets.filter(asset => asset.status === 'ready' &&
    data.scenes.some(scene => scene.panoramaAssetId === asset.id));
  const shareUrl = shareToken ? `${window.location.origin}/share/${shareToken}` : '';
  return <main className="manage-page page-wrap">
    <div className="manage-heading">
      <div><p className="eyebrow">Project management</p><h1>{data.tour.title}</h1>
        <p className="muted">Update project settings and review its uploaded photos.</p></div>
      <Link className="button button--secondary" to={`/tours/${tourId}`}>Back to canvas</Link>
    </div>
    {error && <p className="status" data-tone="error" role="alert">{error}</p>}
    <section className="manage-section panel" aria-labelledby="manage-settings-heading">
      <p className="eyebrow">Settings</p><h2 id="manage-settings-heading">Project details</h2>
      <form className="stacked-form manage-settings-form" onSubmit={event => void saveSettings(event)}>
        <label className="field">Project name<input required maxLength={120} value={title}
          onChange={event => setTitle(event.target.value)} /></label>
        <label className="field">Photo north calibration (°)<input type="number" step="any" required
          value={northYaw} onChange={event => setNorthYaw(event.target.value)} /></label>
        <button className="button button--secondary" disabled={busy}>Save project settings</button>
      </form>
    </section>
    <section className="manage-section panel" aria-labelledby="manage-share-heading">
      <p className="eyebrow">Sharing</p><h2 id="manage-share-heading">Share walkthrough</h2>
      <p className="muted">Anyone with the link can view the walkthrough without signing in. The link stays active until you revoke it or delete the project. It does not grant access to Edit mode or the canvas.</p>
      {shareToken ? <div className="manage-share-controls">
        <label className="field">Share link<input readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} /></label>
        <div className="manage-share-actions">
          <button className="button button--secondary" type="button" onClick={() => void copyShare(shareUrl)}>Copy link</button>
          <button className="button button--danger" type="button" disabled={shareBusy} onClick={() => void revokeShare()}>Revoke link</button>
        </div>
      </div> : <button className="button button--secondary" type="button" disabled={shareBusy}
        onClick={() => void createShare()}>Create share link</button>}
      {shareStatus && <p className="status" data-tone="success" role="status">{shareStatus}</p>}
    </section>
    <section className="manage-section" aria-labelledby="manage-photos-heading">
      <div className="manage-section-heading"><div><p className="eyebrow">Photos</p>
        <h2 id="manage-photos-heading">Uploaded panoramas <span className="muted">({readyAssets.length})</span></h2></div></div>
      <PhotoUploader key={tourId} tourId={tourId} assets={data.assets} onChanged={refresh} />
      {readyAssets.length ? <ol className="manage-photo-list">{readyAssets.map(asset => {
        const scene = data.scenes.find(item => item.panoramaAssetId === asset.id);
        const placement = data.placements.find(item => item.sceneId === scene?.id);
        const page = data.pages.find(item => item.id === placement?.pageId);
        const confirming = confirmPhotoId === asset.id;
        return <li className="manage-photo-card" key={asset.id}>
          {scene && asset.thumbnailReady ? <PhotoThumbnail tourId={tourId} assetId={asset.id} />
            : <div className="photo-thumb photo-thumb--empty" aria-hidden="true" />}
          <div className="manage-photo-overlay">
            <div className="manage-photo-meta">
              <span className="manage-photo-number">{scene ? numbers.get(scene.id) ?? '?' : '·'}</span>
              <div><strong>{photoNameStem(asset.fileName)}</strong>
                <small>{scene ? page ? `Node ${numbers.get(scene.id) ?? '?'} on ${page.name}` : 'Unplaced photo'
                  : asset.status === 'error' ? 'Upload error' : 'Upload in progress'}</small></div>
            </div>
            {!confirming ? <button className="button button--danger" type="button" disabled={busy}
              onClick={() => setConfirmPhotoId(asset.id)}>Delete photo</button> :
              <div className="manage-photo-confirm" role="group" aria-label={`Delete ${asset.fileName}`}>
                <p>{scene ? 'Delete this photo, its node, and all links to or from it?' : 'Remove this upload?'}</p>
                <div><button className="button button--danger" type="button" disabled={busy}
                  onClick={() => void deletePhoto(asset)}>Delete photo</button>
                  <button className="button button--secondary" type="button" disabled={busy}
                    onClick={() => setConfirmPhotoId(null)}>Cancel</button></div>
              </div>}
          </div>
        </li>;
      })}</ol> : <p className="empty-copy">No ready photos yet.</p>}
    </section>
    <section className="manage-section manage-danger-section panel" aria-labelledby="manage-delete-heading">
      <p className="eyebrow">Danger zone</p><h2 id="manage-delete-heading">Delete project</h2>
      {!confirmTourDelete ? <><p className="muted">Permanently remove this project, its pages, photos, links, and stored images.</p>
        <button className="button button--danger" type="button" disabled={busy}
          onClick={() => setConfirmTourDelete(true)}>Delete project</button></> :
        <div className="delete-confirm" role="group" aria-label={`Delete ${data.tour.title}`}>
          <p><strong>Delete “{data.tour.title}” permanently?</strong></p>
          <p>All pages, photos, nodes, links, and stored images in this project will be removed.</p>
          <div className="delete-confirm-actions">
            <button className="button button--danger" type="button" disabled={busy}
              onClick={() => void deleteTour()}>Delete project permanently</button>
            <button className="button button--secondary" type="button" disabled={busy}
              onClick={() => setConfirmTourDelete(false)}>Cancel</button>
          </div>
        </div>}
    </section>
  </main>;
}
