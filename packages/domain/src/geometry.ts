export interface PlanPoint {
  x: number;
  y: number;
}

export function normalize360(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new RangeError('Angle must be finite');
  return ((degrees % 360) + 360) % 360;
}

/** Clockwise heading from north, with page x right and y down. */
export function planBearing(source: PlanPoint, target: PlanPoint, northAngleDeg = 0): number {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (![dx, dy, northAngleDeg].every(Number.isFinite)) throw new RangeError('Coordinates must be finite');
  if (dx === 0 && dy === 0) throw new RangeError('A zero-length connection has no bearing');
  return normalize360(Math.atan2(dx, -dy) * 180 / Math.PI - northAngleDeg);
}
