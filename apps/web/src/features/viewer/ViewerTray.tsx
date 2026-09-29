import { useEffect, useId, useState } from 'react';
import type { ViewerScene } from '@pano/domain';

interface ViewerTrayProps {
  scenes: readonly ViewerScene[];
  activeSceneId: string;
  onSelectScene: (sceneId: string) => void;
  sceneNumbers?: ReadonlyMap<string, number>;
  autoCollapseMs?: number;
}

export function ViewerTray({ scenes, activeSceneId, onSelectScene, sceneNumbers, autoCollapseMs }: ViewerTrayProps) {
  const [open, setOpen] = useState(true);
  const [touched, setTouched] = useState(false);
  const trayId = useId();

  useEffect(() => {
    if (autoCollapseMs === undefined || touched) return;
    const timer = window.setTimeout(() => setOpen(false), autoCollapseMs);
    return () => window.clearTimeout(timer);
  }, [autoCollapseMs, touched]);

  return <div className="viewer-tray-drawer" data-open={open}>
    <button className="viewer-tray-toggle" type="button" aria-controls={trayId} aria-expanded={open}
      onClick={() => { setTouched(true); setOpen(value => !value); }}>
      <span aria-hidden="true">{open ? '⌄' : '⌃'}</span> Photos
    </button>
    <div id={trayId} className="viewer-tray" aria-label="Tour photos" aria-hidden={!open} inert={!open}>
      {scenes.map((scene, index) => <button key={scene.id} type="button" className="viewer-tray-item"
        aria-current={scene.id === activeSceneId ? 'true' : undefined}
        onClick={() => { setTouched(true); onSelectScene(scene.id); }}>
        <img src={scene.thumbnailUrl} alt="" loading="lazy" />
        <span className="viewer-tray-number">{sceneNumbers?.get(scene.id) ?? index + 1}</span>
        <span className="viewer-tray-label">{scene.name}</span>
      </button>)}
    </div>
  </div>;
}
