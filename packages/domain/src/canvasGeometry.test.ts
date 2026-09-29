import { describe, expect, it } from 'vitest';
import { fitPage, viewportToPage, zoomCanvas } from './canvasGeometry.js';

describe('canvas page coordinates', () => {
  it('keeps a page point under the cursor while zooming', () => {
    const view = fitPage(1200, 800);
    const point = viewportToPage(600, 350, view);
    const zoomed = zoomCanvas(view, 600, 350, 1.6);
    expect(viewportToPage(600, 350, zoomed).x).toBeCloseTo(point.x);
    expect(viewportToPage(600, 350, zoomed).y).toBeCloseTo(point.y);
  });
});
