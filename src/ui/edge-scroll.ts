/**
 * RTS-style edge scrolling (desktop mouse only): when the cursor rests near a screen edge the
 * camera pans that way, faster the closer the cursor is to the edge.
 */
export const EDGE_ZONE_PX = 28;

export interface EdgeRect { left: number; top: number; width: number; height: number }

/**
 * Scroll direction for a cursor position. Returns x (+ = right) and y (+ = screen top), each in
 * [-1, 1]. Zero when the cursor is outside the rect or away from every edge.
 */
export function edgeScrollVector(px: number, py: number, rect: EdgeRect, zone = EDGE_ZONE_PX): { x: number; y: number } {
  const lx = px - rect.left, ly = py - rect.top;
  if (lx < 0 || ly < 0 || lx > rect.width || ly > rect.height) return { x: 0, y: 0 };
  // keep the zone sensible on tiny viewports
  const z = Math.max(1, Math.min(zone, rect.width / 4, rect.height / 4));
  const axis = (d: number, size: number) => {
    if (d < z) return -(1 - d / z);
    if (d > size - z) return 1 - (size - d) / z;
    return 0;
  };
  // ease in so the first few pixels of the zone scroll gently
  const ease = (v: number) => Math.sign(v) * (0.35 + 0.65 * Math.abs(v));
  const x = axis(lx, rect.width), y = -axis(ly, rect.height);
  return { x: x ? ease(x) : 0, y: y ? ease(y) : 0 };
}
