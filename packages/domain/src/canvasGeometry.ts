export const PAGE_SIZE = 1000;

export interface CanvasView { scale: number; x: number; y: number; }

export function fitPage(width: number, height: number): CanvasView {
  const scale = Math.max(.1, Math.min((width - 32) / PAGE_SIZE, (height - 32) / PAGE_SIZE));
  return { scale, x: (width - PAGE_SIZE * scale) / 2, y: (height - PAGE_SIZE * scale) / 2 };
}

export function viewportToPage(x: number, y: number, view: CanvasView): { x: number; y: number } {
  return { x: (x - view.x) / view.scale, y: (y - view.y) / view.scale };
}

export function zoomCanvas(view: CanvasView, anchorX: number, anchorY: number, factor: number): CanvasView {
  const scale = Math.max(.2, Math.min(4, view.scale * factor));
  const page = viewportToPage(anchorX, anchorY, view);
  return { scale, x: anchorX - page.x * scale, y: anchorY - page.y * scale };
}
