import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Page, TourEditorData } from '@pano/domain';
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
  const [newPageName, setNewPageName] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const refreshSequence = useRef(0);

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

  async function refresh() {
    const sequence = ++refreshSequence.current;
    const updated = await tourApi.get(tourId);
    if (sequence === refreshSequence.current) setData(updated);
  }

  async function commit(action: string, command: (current: TourEditorData) => Promise<TourEditorData>) {
    if (!data || saveState === 'saving') return;
    setSaveState('saving');
    setError('');
    try {
      const updated = await command(data);
      setData(updated);
      setSaveState('saved');
      logAction(action, 'success', { tourId });
      return updated;
    } catch (cause) {
      setSaveState('error');
      setError(errorMessage(cause));
      logAction(action, 'failure', { tourId });
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
    await commit('placement.update', current => tourApi.updatePlacement(tourId, placementId, {
      x: point.x, y: point.y, expectedVersion: current.tour.version
    }));
  }

  async function deleteNode() {
    if (!selectedPlacement) return;
    const updated = await commit('placement.delete', current => tourApi.deletePlacement(tourId,
      selectedPlacement.id, current.tour.version));
    if (updated) setSelectedPlacementId(null);
  }

  async function deleteSelectedPage() {
    if (!data || !selectedPage || data.pages.length <= 1) return;
    const updated = await commit('page.delete', (current) => tourApi.deletePage(tourId, selectedPage.id, current.tour.version));
    if (updated) setSelectedPageId(updated.pages[0]?.id ?? null);
  }

  return <main className="editor-page">
    {error && <p className="editor-error status" data-tone="error" role="alert">{error}</p>}
    <div className="editor-layout">
      <aside className="editor-library panel">
        <p className="eyebrow">Photo library</p><h2>Panoramas</h2>
        <PhotoLibrary key={tourId} tourId={tourId} assets={data.assets} scenes={data.scenes}
          placedSceneIds={placedSceneIds} selectedSceneId={selectedSceneId}
          onSelect={sceneId => { setSelectedSceneId(sceneId); setSelectedPlacementId(null); }} onChanged={refresh} />
        <div className="panel-divider" />
        <p className="eyebrow">Tour settings</p>
        <TourSettings key={data.tour.id} title={data.tour.title} northYaw={data.tour.defaultNorthYawDeg} disabled={saveState === 'saving'} onSave={(title, defaultNorthYawDeg) => void commit('tour.update', (current) => tourApi.update(tourId, { title, defaultNorthYawDeg, expectedVersion: current.tour.version }))} />
      </aside>
      <section className="editor-center" aria-label="Floor pages">
        <div className="page-tabs" role="tablist" aria-label="Floor pages">{data.pages.map((page) => <button role="tab" aria-selected={selectedPage?.id === page.id} className="page-tab" key={page.id} onClick={() => { setSelectedPageId(page.id); setSelectedPlacementId(null); }}>{page.name}</button>)}</div>
        {selectedPage ? <PlanCanvas key={selectedPage.id} tourId={tourId} page={selectedPage} tourVersion={data.tour.version}
          underlays={data.underlays} scenes={data.scenes}
          placements={data.placements.filter(placement => placement.pageId === selectedPage.id)}
          selectedSceneId={selectedSceneId} selectedPlacementId={selectedPlacementId}
          onPlace={(sceneId, point) => void placeScene(sceneId, point)}
          onSelectPlacement={id => { setSelectedPlacementId(id); if (id) setSelectedSceneId(null); }}
          onMove={(id, point) => void moveNode(id, point)} onChanged={refresh} /> : <div className="canvas-area"><p>No pages yet. Add a page to begin.</p></div>}
      </section>
      <aside className="editor-inspector panel">
        <p className="eyebrow">Inspector</p><h2>{selectedPlacement ? data.scenes.find(scene => scene.id === selectedPlacement.sceneId)?.name || 'Node' : selectedPage?.name || 'Pages'}</h2>
        {selectedPlacement && <NodeInspector placementId={selectedPlacement.id} sceneId={selectedPlacement.sceneId}
          x={selectedPlacement.x} y={selectedPlacement.y} data={data} disabled={saveState === 'saving'}
          onMove={point => void moveNode(selectedPlacement.id, point)} onDelete={() => void deleteNode()} />}
        {selectedPlacement && <div className="panel-divider" />}
        {selectedPlacement && <p className="eyebrow">Page settings</p>}
        {selectedPage && <PageSettings key={selectedPage.id} page={selectedPage} disabled={saveState === 'saving'} onSave={(name, northAngleDeg) => void commit('page.update', (current) => tourApi.updatePage(tourId, selectedPage.id, { name, northAngleDeg, expectedVersion: current.tour.version }))} />}
        {selectedPage && <DeletePageControl key={`delete-${selectedPage.id}`} page={selectedPage} nodeCount={pageNodeCount} isLastPage={data.pages.length <= 1} disabled={saveState === 'saving'} onDelete={() => void deleteSelectedPage()} />}
        <div className="panel-divider" />
        <form className="stacked-form" onSubmit={(event) => void addPage(event)}><label className="field">Add a floor or section<input maxLength={120} required placeholder="e.g. First floor" value={newPageName} onChange={(event) => setNewPageName(event.target.value)} /></label><button className="button button--secondary" disabled={saveState === 'saving'}>Add page</button></form>
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

function NodeInspector({ placementId, sceneId, x, y, data, disabled, onMove, onDelete }: {
  placementId: string; sceneId: string; x: number; y: number; data: TourEditorData; disabled: boolean;
  onMove: (point: { x: number; y: number }) => void; onDelete: () => void;
}) {
  const [positionX, setPositionX] = useState(String(Math.round(x)));
  const [positionY, setPositionY] = useState(String(Math.round(y)));
  useEffect(() => { setPositionX(String(Math.round(x))); setPositionY(String(Math.round(y))); }, [x, y]);
  const connections = data.connections.filter(connection => connection.placementAId === placementId || connection.placementBId === placementId);
  const viewerLinks = data.links.filter(link => link.planConnectionId === null &&
    (link.sourceSceneId === sceneId || link.targetSceneId === sceneId));
  function sceneName(id: string) { return data.scenes.find(scene => scene.id === id)?.name || 'Photo'; }
  return <div className="node-inspector">
    <p className="muted">Canvas node · {data.pages.find(page => page.id === data.placements.find(placement => placement.id === placementId)?.pageId)?.name}</p>
    <form className="node-position-form" onSubmit={event => {
      event.preventDefault();
      onMove({ x: Number(positionX), y: Number(positionY) });
    }}>
      <label className="field">X<input type="number" min="0" max="1000" step="any" required value={positionX} onChange={event => setPositionX(event.target.value)} /></label>
      <label className="field">Y<input type="number" min="0" max="1000" step="any" required value={positionY} onChange={event => setPositionY(event.target.value)} /></label>
      <button className="button button--secondary" disabled={disabled}>Move node</button>
    </form>
    <h3>Connected nodes</h3>
    {connections.length ? <ul>{connections.map(connection => {
      const otherId = connection.placementAId === placementId ? connection.placementBId : connection.placementAId;
      const other = data.placements.find(placement => placement.id === otherId);
      return <li key={connection.id}>{other ? sceneName(other.sceneId) : 'Photo'}</li>;
    })}</ul> : <p className="muted">No canvas connections yet.</p>}
    <h3>Viewer links</h3>
    {viewerLinks.length ? <ul>{viewerLinks.map(link => <li key={link.id}>
      {link.sourceSceneId === sceneId ? `To ${sceneName(link.targetSceneId)}` : `From ${sceneName(link.sourceSceneId)}`}
    </li>)}</ul> : <p className="muted">No custom viewer links yet.</p>}
    <button className="button button--secondary" disabled title="Available after viewer link integration">Create Link</button>
    <p className="muted">Canvas links will be enabled after the panorama direction check.</p>
    <button className="text-button text-button--danger" disabled={disabled}
      onClick={() => { if (window.confirm('Delete this node? Its plan connections will be removed. The photo will remain.')) onDelete(); }}>Delete node</button>
  </div>;
}

function TourSettings({ title, northYaw, disabled, onSave }: {
  title: string; northYaw: number; disabled: boolean; onSave: (title: string, northYaw: number) => void;
}) {
  const [name, setName] = useState(title);
  const [yaw, setYaw] = useState(String(northYaw));
  return <form className="stacked-form" onSubmit={(event) => { event.preventDefault(); onSave(name.trim(), Number(yaw)); }}>
    <label className="field">Tour name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label className="field">Photo north calibration (°)<input type="number" step="any" required value={yaw} onChange={(event) => setYaw(event.target.value)} /></label>
    <button className="button button--secondary" disabled={disabled}>Save tour settings</button>
  </form>;
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
