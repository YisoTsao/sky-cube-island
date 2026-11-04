/**
 * Touch gesture recogniser for the tactical camera (pure, DOM-free so it can be unit-tested).
 *
 * - one finger: tap (short, barely moved) or drag-to-pan
 * - two fingers: pinch to zoom, move the midpoint to pan, twist ≥ ~40° for a 90° camera turn
 *
 * Once a gesture has panned/pinched or used a second finger it can no longer become a tap,
 * so accidental builds never happen while moving the camera.
 */
export type GestureAction =
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; factor: number }
  | { type: 'rotate'; dir: 1 | -1 };

export interface TapResult { x: number; y: number }

interface Pt { x: number; y: number; sx: number; sy: number }

export const TAP_SLOP_PX = 10;
export const TAP_MAX_MS = 450;
export const TWIST_RAD = (40 * Math.PI) / 180;

export class TouchGestures {
  private pts = new Map<number, Pt>();
  private startTime = 0;
  private maxPointers = 0;
  private moved = false;
  private pinchDist = 0;
  private pinchAngle = 0;
  private twistAcc = 0;
  private mid = { x: 0, y: 0 };

  get active(): boolean { return this.pts.size > 0; }
  get pointerCount(): number { return this.pts.size; }

  down(id: number, x: number, y: number, t: number) {
    if (this.pts.size === 0) {
      this.startTime = t;
      this.maxPointers = 0;
      this.moved = false;
      this.twistAcc = 0;
    }
    this.pts.set(id, { x, y, sx: x, sy: y });
    this.maxPointers = Math.max(this.maxPointers, this.pts.size);
    this.resetPair();
  }

  move(id: number, x: number, y: number): GestureAction[] {
    const p = this.pts.get(id);
    if (!p) return [];
    const out: GestureAction[] = [];
    if (this.pts.size === 1) {
      const dx = x - p.x, dy = y - p.y;
      p.x = x; p.y = y;
      if (!this.moved && Math.hypot(x - p.sx, y - p.sy) > TAP_SLOP_PX) {
        this.moved = true;
        // release the slop so the camera does not jump
        out.push({ type: 'pan', dx: x - p.sx, dy: y - p.sy });
        return out;
      }
      if (this.moved && (dx || dy)) out.push({ type: 'pan', dx, dy });
      return out;
    }
    p.x = x; p.y = y;
    this.moved = true;
    const [a, b] = this.pair();
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (mid.x !== this.mid.x || mid.y !== this.mid.y) out.push({ type: 'pan', dx: mid.x - this.mid.x, dy: mid.y - this.mid.y });
    if (dist !== this.pinchDist) out.push({ type: 'zoom', factor: dist / this.pinchDist });
    let da = angle - this.pinchAngle;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    this.twistAcc += da;
    if (Math.abs(this.twistAcc) >= TWIST_RAD) {
      out.push({ type: 'rotate', dir: this.twistAcc > 0 ? 1 : -1 });
      this.twistAcc = 0;
    }
    this.mid = mid; this.pinchDist = dist; this.pinchAngle = angle;
    return out;
  }

  /** True while exactly this one finger has been down the whole gesture without moving (a long-press candidate). */
  stillSingle(id: number): boolean {
    return this.pts.size === 1 && this.pts.has(id) && this.maxPointers === 1 && !this.moved;
  }

  /** Returns a tap when a single, short, stationary touch ends. */
  up(id: number, x: number, y: number, t: number): TapResult | null {
    const p = this.pts.get(id);
    if (!p) return null;
    this.pts.delete(id);
    this.resetPair();
    if (this.pts.size > 0) return null;
    const isTap = this.maxPointers === 1 && !this.moved && t - this.startTime <= TAP_MAX_MS && Math.hypot(x - p.sx, y - p.sy) <= TAP_SLOP_PX;
    return isTap ? { x, y } : null;
  }

  cancel(id: number) {
    this.pts.delete(id);
    this.moved = true;
    this.resetPair();
  }

  private pair(): [Pt, Pt] {
    const it = this.pts.values();
    return [it.next().value as Pt, it.next().value as Pt];
  }

  private resetPair() {
    if (this.pts.size >= 2) {
      const [a, b] = this.pair();
      this.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.pinchDist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      this.pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
    } else if (this.pts.size === 1) {
      // continuing with one finger after a pinch: pan from where it is now
      const [a] = this.pts.values();
      a!.sx = a!.x; a!.sy = a!.y;
    }
  }
}

/** Pinch factor → CameraRig.zoomBy delta (zoomBy scales by exp(-delta * 0.0015)). */
export function pinchToWheelDelta(factor: number): number {
  return -Math.log(Math.max(0.2, Math.min(5, factor))) / 0.0015;
}
