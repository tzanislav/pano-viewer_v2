import { describe, expect, it } from 'vitest';
import { normalize360, planBearing } from './geometry.js';

describe('plan bearing', () => {
  const center = { x: 500, y: 500 };
  it.each([
    [{ x: 500, y: 400 }, 0],
    [{ x: 600, y: 500 }, 90],
    [{ x: 500, y: 600 }, 180],
    [{ x: 400, y: 500 }, 270]
  ])('maps a cardinal page point to heading', (target, heading) => {
    expect(planBearing(center, target)).toBe(heading);
    expect(planBearing(target, center)).toBe(normalize360(heading + 180));
  });

  it('accounts for a rotated north arrow', () => {
    expect(planBearing(center, { x: 600, y: 500 }, 90)).toBe(0);
  });

  it('rejects a zero-length connection', () => {
    expect(() => planBearing(center, center)).toThrow(RangeError);
  });
});
