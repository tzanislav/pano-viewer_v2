import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { ViewerLink, ViewerManifest } from '@pano/domain';
import { PanoramaAdapter } from './PanoramaAdapter';

interface Direction { yawDeg: number; pitchDeg: number }

export function PanoramaStage({ manifest, activeSceneId, requestedSceneId, editMode, selectedLinkId,
  onSceneChange, onSelectLink, onClick, onCommitLink, onError }: {
  manifest: ViewerManifest;
  activeSceneId: string;
  requestedSceneId: string | null;
  editMode: boolean;
  selectedLinkId: string | null;
  onSceneChange: (id: string) => void;
  onSelectLink: (id: string) => void;
  onClick: (direction: Direction) => void;
  onCommitLink: (id: string, direction: Direction) => void;
  onError: (message: string) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const adapter = useRef<PanoramaAdapter | null>(null);
  const callbacks = useRef({ onSceneChange, onClick, onError });
  const [frame, setFrame] = useState(0);
  const [draft, setDraft] = useState<{ id: string; direction: Direction } | null>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const initialManifest = useRef(true);
  callbacks.current = { onSceneChange, onClick, onError };

  useEffect(() => {
    if (!element.current) return;
    let frameId = 0;
    const instance = new PanoramaAdapter(element.current, manifest, {
      onSceneChange: id => callbacks.current.onSceneChange(id),
      onClick: direction => callbacks.current.onClick(direction),
      onError: message => callbacks.current.onError(message),
      onViewChange: () => {
        if (frameId) return;
        frameId = requestAnimationFrame(() => { frameId = 0; setFrame(value => value + 1); });
      }
    });
    adapter.current = instance;
    return () => { cancelAnimationFrame(frameId); instance.destroy(); adapter.current = null; };
  }, []);

  useEffect(() => {
    if (initialManifest.current) { initialManifest.current = false; return; }
    adapter.current?.refresh(manifest);
  }, [manifest]);

  useEffect(() => {
    if (!requestedSceneId || !adapter.current || adapter.current.currentSceneId() === requestedSceneId) return;
    void adapter.current.goTo(requestedSceneId).catch(() => callbacks.current.onError('Could not open this panorama. Try again.'));
  }, [requestedSceneId]);

  const scene = manifest.scenes.find(item => item.id === activeSceneId);
  const links = scene?.links || [];
  void frame;

  function move(event: PointerEvent<HTMLButtonElement>, link: ViewerLink) {
    if (!drag.current || drag.current.id !== link.id || !adapter.current) return;
    const direction = adapter.current.directionAt(event.clientX, event.clientY);
    drag.current.moved = true;
    setDraft({ id: link.id, direction });
  }

  function finish(event: PointerEvent<HTMLButtonElement>, link: ViewerLink) {
    if (!drag.current || drag.current.id !== link.id) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const moved = drag.current.moved;
    drag.current = null;
    const direction = adapter.current?.directionAt(event.clientX, event.clientY) ||
      (draft?.id === link.id ? draft.direction : null);
    setDraft(null);
    onSelectLink(link.id);
    if (moved && direction) onCommitLink(link.id, direction);
  }

  return <div className="panorama-stage" data-edit-mode={editMode}>
    <div ref={element} className="panorama-surface" aria-label="360 panorama" />
    {editMode && <div className="panorama-link-layer">
      {links.map(link => {
        const direction = draft?.id === link.id ? draft.direction : link;
        const point = adapter.current?.screenPoint(direction.yawDeg, direction.pitchDeg);
        if (!point) return null;
        const target = manifest.scenes.find(item => item.id === link.targetSceneId);
        return <button key={link.id} type="button" className="panorama-link-handle"
          data-selected={selectedLinkId === link.id}
          style={{ left: point.x, top: point.y }}
          title={`Drag link to ${target?.name || 'photo'}`}
          aria-label={`Drag link to ${target?.name || 'photo'}`}
          onPointerDown={event => {
            event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { id: link.id, moved: false };
          }}
          onPointerMove={event => move(event, link)}
          onPointerUp={event => finish(event, link)}
          onClick={event => event.stopPropagation()}
          onPointerCancel={() => { drag.current = null; setDraft(null); }}>
          <span aria-hidden="true">↗</span>
        </button>;
      })}
    </div>}
  </div>;
}

