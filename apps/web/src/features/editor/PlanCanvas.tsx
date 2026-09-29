import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { fitPage, PAGE_SIZE, sceneDisplayNumbers, viewportToPage, zoomCanvas,
  type CanvasView, type Page, type Placement, type Scene, type UnderlayUpload } from '@pano/domain';
import { tourApi } from '../tours/tourApi';
import { UnderlayControl } from './UnderlayControl';

type Point = { x: number; y: number };

export function PlanCanvas({ tourId, page, tourVersion, underlays, scenes, placements,
  selectedSceneId, selectedPlacementId, onPlace, onSelectPlacement, onMove, onChanged }: {
  tourId: string; page: Page; tourVersion: number; underlays: UnderlayUpload[];
  scenes: Scene[]; placements: Placement[]; selectedSceneId: string | null; selectedPlacementId: string | null;
  onPlace: (sceneId: string, point: Point) => void; onSelectPlacement: (id: string | null) => void;
  onMove: (placementId: string, point: Point) => void; onChanged: () => Promise<void>;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ id: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const nodeDrag = useRef<{ id: number; placementId: string; startX: number; startY: number; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<{ id: string; point: Point } | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<CanvasView>(() => fitPage(800, 600));
  const [underlayUrl, setUnderlayUrl] = useState('');
  const underlay = underlays.find(upload => upload.id === page.planAssetId);
  const numbers = sceneDisplayNumbers(scenes);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setView(fitPage(size.width, size.height)); }, [page.id, size.width, size.height]);

  useEffect(() => {
    setUnderlayUrl('');
    if (!page.planAssetId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const result = await tourApi.underlayUrl(tourId, page.id);
        if (!active) return;
        setUnderlayUrl(result.url);
        timer = setTimeout(() => void load(), Math.max(30, result.expiresIn - 60) * 1000);
      } catch { if (active) setUnderlayUrl(''); }
    }
    void load();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [tourId, page.id, page.planAssetId]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      setView(current => zoomCanvas(current, event.clientX - rect.left, event.clientY - rect.top,
        event.deltaY < 0 ? 1.12 : 1 / 1.12));
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  function pagePoint(clientX: number, clientY: number): Point {
    const rect = viewport.current!.getBoundingClientRect();
    return viewportToPage(clientX - rect.left, clientY - rect.top, view);
  }

  function inPage(point: Point): boolean {
    return point.x >= 0 && point.x <= PAGE_SIZE && point.y >= 0 && point.y <= PAGE_SIZE;
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pan.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: view.x, y: view.y, moved: false };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = pan.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (Math.hypot(dx, dy) > 4) current.moved = true;
    if (current.moved) setView(previous => ({ ...previous, x: current.x + dx, y: current.y + dy }));
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = pan.current;
    if (!current || current.id !== event.pointerId) return;
    pan.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.moved) {
      const point = pagePoint(event.clientX, event.clientY);
      if (selectedSceneId && inPage(point)) onPlace(selectedSceneId, point);
      else if (!selectedSceneId) onSelectPlacement(null);
    }
  }

  function nodePointerDown(event: PointerEvent<HTMLButtonElement>, placement: Placement) {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    nodeDrag.current = { id: event.pointerId, placementId: placement.id,
      startX: event.clientX, startY: event.clientY, moved: false };
  }

  function nodePointerMove(event: PointerEvent<HTMLButtonElement>, placement: Placement) {
    event.stopPropagation();
    const current = nodeDrag.current;
    if (!current || current.id !== event.pointerId || current.placementId !== placement.id) return;
    if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4) current.moved = true;
    if (current.moved) {
      const point = pagePoint(event.clientX, event.clientY);
      setPreview({ id: placement.id, point: {
        x: Math.max(0, Math.min(PAGE_SIZE, point.x)), y: Math.max(0, Math.min(PAGE_SIZE, point.y))
      } });
    }
  }

  function nodePointerUp(event: PointerEvent<HTMLButtonElement>, placement: Placement) {
    event.stopPropagation();
    const current = nodeDrag.current;
    if (!current || current.id !== event.pointerId || current.placementId !== placement.id) return;
    nodeDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.moved) {
      const point = pagePoint(event.clientX, event.clientY);
      onMove(placement.id, { x: Math.max(0, Math.min(PAGE_SIZE, point.x)),
        y: Math.max(0, Math.min(PAGE_SIZE, point.y)) });
    }
    else onSelectPlacement(placement.id);
    setPreview(null);
  }

  const frame = underlay?.width && underlay.height ? (() => {
    const ratio = underlay.width / underlay.height;
    const width = ratio >= 1 ? PAGE_SIZE : PAGE_SIZE * ratio;
    const height = ratio >= 1 ? PAGE_SIZE / ratio : PAGE_SIZE;
    return { left: (PAGE_SIZE - width) / 2, top: (PAGE_SIZE - height) / 2, width, height };
  })() : { left: 0, top: 0, width: PAGE_SIZE, height: PAGE_SIZE };

  return <div className="canvas-area" role="tabpanel" aria-label={`${page.name} plan`}>
    <div className="canvas-toolbar">
      <span className="canvas-hint">{selectedSceneId ? 'Click the canvas to place this photo' : 'Drag to pan · Scroll to zoom'}</span>
      <div className="canvas-toolbar-actions">
        {selectedSceneId && <button className="text-button" type="button"
          onClick={() => onPlace(selectedSceneId, { x: PAGE_SIZE / 2, y: PAGE_SIZE / 2 })}>Place at center</button>}
        <button className="text-button" type="button" onClick={() => setView(fitPage(size.width, size.height))}>Fit</button>
        <button className="text-button" type="button" aria-label="Zoom out" onClick={() => setView(current => zoomCanvas(current, size.width / 2, size.height / 2, 1 / 1.25))}>−</button>
        <button className="text-button" type="button" aria-label="Zoom in" onClick={() => setView(current => zoomCanvas(current, size.width / 2, size.height / 2, 1.25))}>+</button>
        <UnderlayControl tourId={tourId} page={page} tourVersion={tourVersion} uploads={underlays} onChanged={onChanged} />
      </div>
    </div>
    <div ref={viewport} className="canvas-viewport" data-placing={Boolean(selectedSceneId)}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { pan.current = null; }}>
      <div className="canvas-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        {underlayUrl && <img className="canvas-underlay" src={underlayUrl} alt="" draggable={false} style={frame} />}
        {placements.map(placement => {
          const scene = scenes.find(candidate => candidate.id === placement.sceneId);
          const point = preview?.id === placement.id ? preview.point : placement;
          return <button key={placement.id} className="canvas-node" type="button" aria-label={`${scene?.name || 'Photo'} node ${scene ? numbers.get(scene.id) : ''}`}
            aria-pressed={selectedPlacementId === placement.id} style={{ left: point.x, top: point.y,
              transform: `translate(-50%, -50%) scale(${1 / view.scale})` }}
            onPointerDown={event => nodePointerDown(event, placement)}
            onPointerMove={event => nodePointerMove(event, placement)}
            onPointerUp={event => nodePointerUp(event, placement)}
            onPointerCancel={() => { nodeDrag.current = null; setPreview(null); }}
            onClick={event => { event.stopPropagation(); onSelectPlacement(placement.id); }}>{scene ? numbers.get(scene.id) : '?'}</button>;
        })}
        {!underlayUrl && placements.length === 0 && <div className="canvas-empty"><span className="eyebrow">{page.name}</span><h2>Plan canvas</h2><p>Upload an underlay or select a photo to place its node.</p></div>}
      </div>
      <div className="north-arrow" title={`North arrow: ${page.northAngleDeg} degrees clockwise from up`}
        onPointerDown={event => event.stopPropagation()}
        style={{ transform: `rotate(${page.northAngleDeg}deg)` }}>↑<span>N</span></div>
    </div>
  </div>;
}
