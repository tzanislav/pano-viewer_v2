import { useEffect, useRef, useState, type FormEvent } from 'react';
import { checkPlacedNodeReachability, sceneDisplayNumbers, type Page, type PanoramaAsset, type Scene,
  type TourEditorData } from '@pano/domain';
import { useParams } from 'react-router-dom';
import { errorMessage } from '../../app/apiClient';
import { useWorkspaceHeader, type SaveState } from '../../app/AppShell';
import { logAction } from '../../app/logAction';
import { tourApi } from '../tours/tourApi';
import { PhotoLibrary } from './PhotoLibrary';
import { PlanCanvas } from './PlanCanvas';

export function TourEditor() {
  const { tourId = '' } = useParams();
  const setWorkspaceHeader = useWorkspaceHeader();
  const [data, setData] = useState<TourEditorData | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [connectingPlacementId, setConnectingPlacementId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{ id: string; point: { x: number; y: number } } | null>(null);
  const [newPageName, setNewPageName] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const refreshSequence = useRef(0);
  const mutating = useRef(false);

  useEffect(() => {
    let active = true;
    void tourApi.get(tourId).then((result) => {
      if (!active) return;
      setData(result);
      setSelectedPageId(result.pages[0]?.id ?? null);
    }).catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [tourId]);

  useEffect(() => {
    if (data?.tour.id === tourId) setWorkspaceHeader({ tourId, title: data.tour.title, saveState });
    else setWorkspaceHeader(null);
  }, [data, saveState, setWorkspaceHeader, tourId]);

  useEffect(() => () => setWorkspaceHeader(null), [setWorkspaceHeader]);

  const selectedPage = data?.pages.find((page) => page.id === selectedPageId) || data?.pages[0];
  const selectedPlacement = data?.placements.find(placement => placement.id === selectedPlacementId);
  const selectedPhoto = data?.scenes.find(scene => scene.id === selectedSceneId);
  const selectedPhotoAsset = data?.assets.find(asset => asset.id === selectedPhoto?.panoramaAssetId);

  useEffect(() => {
    if (!pendingMove || !data) return;
    const saved = data.placements.find(placement => placement.id === pendingMove.id);
    if (saved?.x === pendingMove.point.x && saved.y === pendingMove.point.y) setPendingMove(null);
  }, [data, pendingMove]);

  async function refresh() {
    const sequence = ++refreshSequence.current;
    const updated = await tourApi.get(tourId);
    if (sequence === refreshSequence.current) setData(current =>
      current?.tour.id === updated.tour.id && current.tour.version > updated.tour.version ? current : updated);
  }

  async function commit(action: string, command: (current: TourEditorData) => Promise<TourEditorData>) {
    if (!data || mutating.current) return;
    mutating.current = true;
    setSaveState('saving');
    setError('');
    try {
      const updated = await command(data);
      setData(current => current?.tour.id === updated.tour.id && current.tour.version > updated.tour.version ? current : updated);
      setSaveState('saved');
      logAction(action, 'success', { tourId });
      return updated;
    } catch (cause) {
      setSaveState('error');
      setError(errorMessage(cause));
      logAction(action, 'failure', { tourId });
    } finally {
      mutating.current = false;
    }
  }

  async function addPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updated = await commit('page.create', (current) => tourApi.createPage(tourId, {
      name: newPageName.trim(), expectedVersion: current.tour.version
    }));
    if (updated) {
      setSelectedPageId(updated.pages.at(-1)?.id ?? null);
      setNewPageName('');
    }
  }

  if (!data || data.tour.id !== tourId) return <main className="page-wrap"><p className="status" data-tone={error ? 'error' : undefined}>{error || 'Loading tour…'}</p></main>;

  const pageNodeCount = selectedPage ? data.placements.filter((placement) => placement.pageId === selectedPage.id).length : 0;
  const placedSceneIds = new Set(data.placements.map(placement => placement.sceneId));
  const sceneNumbers = sceneDisplayNumbers(data.scenes);
  const nodeLabel = (sceneId: string) => `Node ${sceneNumbers.get(sceneId) ?? '?'}`;
  const outgoingSceneIds = new Set(data.links.map(link => link.sourceSceneId));
  const reachability = checkPlacedNodeReachability(data);
  const unreachableNodeLabels = reachability.unreachableSceneIds.map(nodeLabel);
  const startSceneLabel = reachability.startSceneId
    ? placedSceneIds.has(reachability.startSceneId) ? nodeLabel(reachability.startSceneId)
      : `Photo ${sceneNumbers.get(reachability.startSceneId) ?? '?'}`
    : 'the start scene';
  const placedSelectedPhoto = data.placements.find(placement => placement.sceneId === selectedSceneId);
  const placementSceneId = selectedSceneId && !placedSceneIds.has(selectedSceneId) ? selectedSceneId : null;

  async function placeScene(sceneId: string, point: { x: number; y: number }) {
    if (!selectedPage) return;
    const updated = await commit('placement.create', current => tourApi.createPlacement(tourId, {
      pageId: selectedPage.id, sceneId, x: point.x, y: point.y, expectedVersion: current.tour.version
    }));
    if (updated) {
      setSelectedSceneId(null);
      setSelectedPlacementId(updated.placements.find(placement => placement.sceneId === sceneId)?.id ?? null);
    }
  }

  async function moveNode(placementId: string, point: { x: number; y: number }) {
    if (mutating.current) return;
    setPendingMove({ id: placementId, point });
    const updated = await commit('placement.update', current => tourApi.updatePlacement(tourId, placementId, {
      x: point.x, y: point.y, expectedVersion: current.tour.version
    }));
    if (!updated) setPendingMove(null);
  }

  async function deleteNode() {
    if (!selectedPlacement) return;
    const updated = await commit('placement.delete', current => tourApi.deletePlacement(tourId,
      selectedPlacement.id, current.tour.version));
    if (updated) { setSelectedPlacementId(null); setConnectingPlacementId(null); }
  }

  async function selectCanvasNode(id: string | null) {
    if (mutating.current) return;
    if (!id) { setSelectedSceneId(null); setSelectedPlacementId(null); setConnectingPlacementId(null); return; }
    if (connectingPlacementId) {
      if (id === connectingPlacementId) { setSelectedPlacementId(null); setConnectingPlacementId(null); return; }
      const updated = await commit('connection.create', current => tourApi.createPlanConnection(tourId, {
        placementAId: connectingPlacementId, placementBId: id, expectedVersion: current.tour.version
      }));
      if (updated) { setConnectingPlacementId(null); setSelectedPlacementId(id); }
      return;
    }
    if (id === selectedPlacementId) { setSelectedPlacementId(null); return; }
    setSelectedPlacementId(id);
    setSelectedSceneId(null);
  }

  async function deleteConnection(connectionId: string) {
    await commit('connection.delete', current => tourApi.deletePlanConnection(tourId, connectionId, current.tour.version));
  }

  async function deleteManualLink(linkId: string) {
    await commit('link.delete', current => tourApi.deleteViewerLink(tourId, linkId, current.tour.version));
  }

  async function deleteSelectedPhoto() {
    if (!selectedPhoto) return;
    const updated = await commit('scene.delete', current =>
      tourApi.deleteScene(tourId, selectedPhoto.id, current.tour.version));
    if (updated) { setSelectedSceneId(null); setSelectedPlacementId(null); setConnectingPlacementId(null); }
  }

  async function setStartScene(sceneId: string) {
    await commit('tour.entry-scene.update', current => tourApi.update(tourId, {
      entrySceneId: sceneId, expectedVersion: current.tour.version
    }));
  }

  async function deleteSelectedPage() {
    if (!data || !selectedPage || data.pages.length <= 1) return;
    const updated = await commit('page.delete', (current) => tourApi.deletePage(tourId, selectedPage.id, current.tour.version));
    if (updated) setSelectedPageId(updated.pages[0]?.id ?? null);
  }

  return <main className="editor-page">
    {error && <p className="editor-error status" data-tone="error" role="alert">{error}</p>}
    <div className="editor-layout" inert={saveState === 'saving'} aria-busy={saveState === 'saving'}>
      <aside className="editor-library panel">
        <p className="eyebrow">Photo library</p><h2>Panoramas</h2>
        <PhotoLibrary key={tourId} tourId={tourId} assets={data.assets} scenes={data.scenes}
          placedSceneIds={placedSceneIds} selectedSceneId={selectedSceneId}
          selectedNodeSceneId={selectedPlacement?.sceneId ?? placedSelectedPhoto?.sceneId ?? null}
          outgoingSceneIds={outgoingSceneIds} unreachableNodeLabels={unreachableNodeLabels}
          startSceneLabel={startSceneLabel}
          onSelect={sceneId => {
            setSelectedSceneId(sceneId); setSelectedPlacementId(null); setConnectingPlacementId(null);
            const placement = data.placements.find(item => item.sceneId === sceneId);
            if (placement) setSelectedPageId(placement.pageId);
          }} />
      </aside>
      <section className="editor-center" aria-label="Floor pages">
        <div className="page-tabs" role="tablist" aria-label="Floor pages">{data.pages.map((page) => <button role="tab" aria-selected={selectedPage?.id === page.id} className="page-tab" key={page.id} onClick={() => { setSelectedPageId(page.id); setSelectedPlacementId(null); setConnectingPlacementId(null); }}>{page.name}</button>)}</div>
        {selectedPage ? <PlanCanvas key={selectedPage.id} tourId={tourId} page={selectedPage} tourVersion={data.tour.version}
          underlays={data.underlays} scenes={data.scenes} links={data.links}
          placements={data.placements.filter(placement => placement.pageId === selectedPage.id)}
          connections={data.connections.filter(connection => {
            const placement = data.placements.find(item => item.id === connection.placementAId);
            return placement?.pageId === selectedPage.id;
          })}
          selectedSceneId={placementSceneId} selectedPlacementId={selectedPlacementId ?? placedSelectedPhoto?.id ?? null}
          connectingPlacementId={connectingPlacementId} pendingMove={pendingMove}
          saving={saveState === 'saving'}
          onPlace={(sceneId, point) => void placeScene(sceneId, point)}
          onSelectPlacement={id => { void selectCanvasNode(id); }}
          onMove={(id, point) => void moveNode(id, point)} onChanged={refresh} /> : <div className="canvas-area"><p>No pages yet. Add a page to begin.</p></div>}
      </section>
      <aside className="editor-inspector panel">
        <p className="eyebrow">Inspector</p>
        <h2>{selectedPlacement ? nodeLabel(selectedPlacement.sceneId) : selectedPhoto?.name || selectedPage?.name || 'Pages'}</h2>
        {selectedPlacement && <p className="inspector-photo-subtitle">{data.scenes.find(scene => scene.id === selectedPlacement.sceneId)?.name}</p>}
        {selectedPlacement && <NodeInspector key={selectedPlacement.id} placementId={selectedPlacement.id} sceneId={selectedPlacement.sceneId}
          data={data} sceneNumbers={sceneNumbers} disabled={saveState === 'saving'}
          isStartScene={data.tour.entrySceneId === selectedPlacement.sceneId}
          connecting={connectingPlacementId === selectedPlacement.id}
          onConnect={() => setConnectingPlacementId(current => current === selectedPlacement.id ? null : selectedPlacement.id)}
          onDeleteConnection={id => void deleteConnection(id)} onDeleteManualLink={id => void deleteManualLink(id)}
          onSetStart={() => void setStartScene(selectedPlacement.sceneId)}
          onDelete={() => void deleteNode()} />}
        {!selectedPlacement && selectedPhoto && selectedPhotoAsset && <PhotoInspector key={selectedPhoto.id}
          scene={selectedPhoto} asset={selectedPhotoAsset} data={data} sceneNumbers={sceneNumbers} disabled={saveState === 'saving'}
          onDelete={() => void deleteSelectedPhoto()} />}
        {!selectedPlacement && !selectedPhoto && <>
          {selectedPage && <PageSettings key={selectedPage.id} page={selectedPage} disabled={saveState === 'saving'} onSave={(name, northAngleDeg) => void commit('page.update', (current) => tourApi.updatePage(tourId, selectedPage.id, { name, northAngleDeg, expectedVersion: current.tour.version }))} />}
          {selectedPage && <DeletePageControl key={`delete-${selectedPage.id}`} page={selectedPage} nodeCount={pageNodeCount} isLastPage={data.pages.length <= 1} disabled={saveState === 'saving'} onDelete={() => void deleteSelectedPage()} />}
          <div className="panel-divider" />
          <form className="stacked-form" onSubmit={(event) => void addPage(event)}><label className="field">Add a floor or section<input maxLength={120} required placeholder="e.g. First floor" value={newPageName} onChange={(event) => setNewPageName(event.target.value)} /></label><button className="button button--secondary" disabled={saveState === 'saving'}>Add page</button></form>
        </>}
      </aside>
    </div>
  </main>;
}

function DeletePageControl({ page, nodeCount, isLastPage, disabled, onDelete }: {
  page: Page; nodeCount: number; isLastPage: boolean; disabled: boolean; onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (isLastPage) return <div className="delete-page-control"><button className="text-button text-button--danger" disabled>Delete page</button><p className="status">A tour must keep at least one page.</p></div>;
  return <div className="delete-page-control">
    {!confirming ? <button className="text-button text-button--danger" disabled={disabled} onClick={() => setConfirming(true)}>Delete page</button> :
      <div className="delete-confirm" role="group" aria-label={`Delete ${page.name}`}>
        <p><strong>Delete “{page.name}”?</strong></p>
        <p>{nodeCount} {nodeCount === 1 ? 'node' : 'nodes'} on this page and their plan connections will be removed. Photos and independent viewer links will remain.</p>
        <div className="delete-confirm-actions"><button className="button button--danger" disabled={disabled} onClick={onDelete}>Delete page</button><button className="button button--secondary" disabled={disabled} onClick={() => setConfirming(false)}>Cancel</button></div>
      </div>}
  </div>;
}

function PhotoInspector({ scene, asset, data, sceneNumbers, disabled, onDelete }: {
  scene: Scene; asset: PanoramaAsset; data: TourEditorData; sceneNumbers: ReadonlyMap<string, number>;
  disabled: boolean; onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const placement = data.placements.find(item => item.sceneId === scene.id);
  const page = data.pages.find(item => item.id === placement?.pageId);
  const linkCount = data.links.filter(link => link.sourceSceneId === scene.id || link.targetSceneId === scene.id).length;
  const connectionCount = data.connections.filter(connection =>
    connection.placementAId === placement?.id || connection.placementBId === placement?.id).length;
  return <div className="photo-inspector">
    <p className="muted">360 photo · {page ? `Node ${sceneNumbers.get(scene.id) ?? '?'} on ${page.name}` : 'Unplaced'}</p>
    <dl className="photo-details">
      <div><dt>File</dt><dd>{asset.fileName}</dd></div>
      <div><dt>Dimensions</dt><dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : 'Unknown'}</dd></div>
      <div><dt>Format</dt><dd>{asset.mimeType.replace('image/', '').toUpperCase()}</dd></div>
      <div><dt>Size</dt><dd>{(asset.byteSize / 1024 / 1024).toFixed(1)} MB</dd></div>
      <div><dt>Links</dt><dd>{linkCount}</dd></div>
      {data.tour.entrySceneId === scene.id && <div><dt>Viewer</dt><dd>Start scene</dd></div>}
    </dl>
    <div className="photo-delete-control">
      {!confirming ? <button className="text-button text-button--danger" type="button" disabled={disabled}
        onClick={() => setConfirming(true)}>Delete 360 photo</button> :
        <div className="delete-confirm" role="group" aria-label={`Delete ${scene.name}`}>
          <p><strong>Delete “{scene.name}”?</strong></p>
          <p>This removes the photo{placement ? `, Node ${sceneNumbers.get(scene.id) ?? '?'}` : ''}, {connectionCount} plan {connectionCount === 1 ? 'connection' : 'connections'}, and {linkCount} {linkCount === 1 ? 'link' : 'links'} to or from it.</p>
          <div className="delete-confirm-actions">
            <button className="button button--danger" type="button" disabled={disabled} onClick={onDelete}>Delete photo</button>
            <button className="button button--secondary" type="button" disabled={disabled} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>}
    </div>
  </div>;
}

function NodeInspector({ placementId, sceneId, data, sceneNumbers, disabled, connecting, onConnect,
  isStartScene, onDeleteConnection, onDeleteManualLink, onSetStart, onDelete }: {
  placementId: string; sceneId: string; data: TourEditorData; sceneNumbers: ReadonlyMap<string, number>; disabled: boolean;
  isStartScene: boolean; onSetStart: () => void;
  connecting: boolean; onConnect: () => void; onDeleteConnection: (id: string) => void;
  onDeleteManualLink: (id: string) => void;
  onDelete: () => void;
}) {
  const connections = data.connections.filter(connection => connection.placementAId === placementId || connection.placementBId === placementId);
  const viewerLinks = data.links.filter(link => link.planConnectionId === null &&
    (link.sourceSceneId === sceneId || link.targetSceneId === sceneId));
  const placedSceneIds = new Set(data.placements.map(placement => placement.sceneId));
  function sceneLabel(id: string) {
    return `${placedSceneIds.has(id) ? 'Node' : 'Photo'} ${sceneNumbers.get(id) ?? '?'}`;
  }
  return <div className="node-inspector">
    <p className="muted">Canvas node · {data.pages.find(page => page.id === data.placements.find(placement => placement.id === placementId)?.pageId)?.name}</p>
    <button className="button button--secondary" type="button" disabled={disabled || isStartScene}
      onClick={onSetStart}>{isStartScene ? 'Start scene' : 'Set as start'}</button>
    <h3>Plan connections</h3>
    {connections.length ? <ul className="node-connection-list">{connections.map(connection => {
      const otherId = connection.placementAId === placementId ? connection.placementBId : connection.placementAId;
      const other = data.placements.find(placement => placement.id === otherId);
      const outgoing = data.links.find(link => link.planConnectionId === connection.id && link.sourceSceneId === sceneId);
      const incoming = data.links.find(link => link.planConnectionId === connection.id && link.targetSceneId === sceneId);
      const name = other ? sceneLabel(other.sceneId) : 'Node';
      return <li key={connection.id} className="node-link-row">
        <span><strong>{name}</strong> <small>{outgoing && incoming ? '↔' : outgoing ? '→' : incoming ? '←' : 'No hotspots'}</small></span>
        <button className="node-link-remove" type="button" disabled={disabled}
          aria-label={`Remove plan connection with ${name} and its links`} title="Remove connection and both directions"
          onClick={() => onDeleteConnection(connection.id)}>×</button>
      </li>;
    })}</ul> : <p className="muted">No canvas connections yet.</p>}
    <h3>Manual links</h3>
    {viewerLinks.length ? <ul className="node-connection-list">{viewerLinks.map(link => {
      const outgoing = link.sourceSceneId === sceneId;
      const name = sceneLabel(outgoing ? link.targetSceneId : link.sourceSceneId);
      return <li key={link.id} className="node-link-row">
        <span>{outgoing ? 'To' : 'From'} <strong>{name}</strong></span>
        <button className="node-link-remove" type="button" disabled={disabled}
          aria-label={`Remove manual link ${outgoing ? 'to' : 'from'} ${name}`} title="Remove this hotspot"
          onClick={() => onDeleteManualLink(link.id)}>×</button>
      </li>;
    })}</ul> : <p className="muted">No manual links yet.</p>}
    <button className="button button--secondary" type="button" disabled={disabled}
      aria-pressed={connecting} onClick={onConnect}>{connecting ? 'Cancel link' : 'Create Link'}</button>
    {connecting && <p className="muted" role="status">Choose another node on this page.</p>}
    <div className="node-delete-control"><button className="text-button text-button--danger" disabled={disabled}
      onClick={() => { if (window.confirm('Delete this node? Its plan connections will be removed. The photo will remain.')) onDelete(); }}>Delete node</button>
    </div>
  </div>;
}

function PageSettings({ page, disabled, onSave }: {
  page: Page; disabled: boolean; onSave: (name: string, northAngleDeg: number) => void;
}) {
  const [name, setName] = useState(page.name);
  const [north, setNorth] = useState(String(page.northAngleDeg));
  return <form className="stacked-form" onSubmit={(event) => { event.preventDefault(); onSave(name.trim(), Number(north)); }}>
    <label className="field">Page name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label className="field">North arrow clockwise from up (°)<input type="number" step="any" required value={north} onChange={(event) => setNorth(event.target.value)} /></label>
    <button className="button button--secondary" disabled={disabled}>Save page</button>
  </form>;
}
