import {
  BufferAttribute, BufferGeometry, CanvasTexture, DynamicDrawUsage, Group, LineBasicMaterial, LineSegments, Points,
  PointsMaterial, Sprite, SpriteMaterial, Vector3,
} from 'three';
import type { WeatherKind } from '../../domain/types';

/**
 * Weather (GDD §16 T3「微雨、飄雪、霧天，純表現不影響規則」): light rain streaks, heavy snow or
 * drifting fog banks over the islands. Purely presentational: nothing here reads the simulation,
 * writes depth for picking, casts shadows or covers the tactical overlay (which is drawn after
 * post-processing). `dim` tells the scene how much to soften the sun while it rains or fogs.
 */

export interface WeatherSettings { kind: WeatherKind; density: number; reducedMotion: boolean }

const BOX = { w: 44, h: 14, d: 44 };

function softDot(size: number, inner: string, outer: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

export class Weather {
  readonly group = new Group();
  kind: WeatherKind = 'clear';
  private rain?: LineSegments;
  private snow?: Points;
  private fog: { s: Sprite; v: Vector3; base: number }[] = [];
  private vel: Float32Array = new Float32Array(0);
  private seed = 7;
  private slow = 1;

  constructor(private center: Vector3) {
    this.group.name = 'weather';
  }

  /** Strength (0..1) by which the scene should dim its sun and saturate towards grey. */
  get dim(): number { return this.kind === 'rain' ? 0.38 : this.kind === 'fog' ? 0.18 : this.kind === 'snow' ? 0.08 : 0; }

  private rnd() { this.seed = (this.seed * 16807) % 2147483647; return (this.seed - 1) / 2147483646; }

  private clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      const m = o as unknown as { geometry?: BufferGeometry; material?: { dispose(): void; map?: { dispose(): void } | null } };
      m.geometry?.dispose();
      m.material?.map?.dispose();
      m.material?.dispose();
    }
    this.rain = undefined; this.snow = undefined; this.fog = [];
  }

  configure(o: WeatherSettings) {
    this.clear();
    this.kind = o.kind;
    this.slow = o.reducedMotion ? 0.5 : 1;
    const n = Math.round(o.density * (o.reducedMotion ? 0.5 : 1));
    if (o.kind === 'rain' && n > 0) this.buildRain(n * 6);
    if (o.kind === 'snow' && n > 0) this.buildSnow(n * 5);
    if (o.kind === 'fog') this.buildFog(Math.max(6, Math.round(n / 12)));
  }

  private randomIn(out: Float32Array, i: number) {
    out[i] = this.center.x + (this.rnd() - 0.5) * BOX.w;
    out[i + 1] = -2 + this.rnd() * BOX.h;
    out[i + 2] = this.center.z + (this.rnd() - 0.5) * BOX.d;
  }

  private buildRain(count: number) {
    const pos = new Float32Array(count * 6);
    this.vel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.randomIn(pos, i * 6);
      this.vel[i] = 13 + this.rnd() * 6;
      this.streak(pos, i);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
    this.rain = new LineSegments(geo, new LineBasicMaterial({ color: 0xe4f0ff, transparent: true, opacity: 0.7, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 5;
    this.group.add(this.rain);
  }

  /** Second vertex of a rain streak: a short slanted line behind the head. */
  private streak(pos: Float32Array, i: number) {
    const k = i * 6;
    pos[k + 3] = pos[k]! - 0.12;
    pos[k + 4] = pos[k + 1]! + 0.9;
    pos[k + 5] = pos[k + 2]! - 0.07;
  }

  private buildSnow(count: number) {
    const pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count);
    for (let i = 0; i < count; i++) { this.randomIn(pos, i * 3); this.vel[i] = this.rnd() * 6.28; }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
    this.snow = new Points(geo, new PointsMaterial({
      size: 6, map: softDot(32, 'rgba(255,255,255,1)', 'rgba(235,242,255,0)'), transparent: true, depthWrite: false,
      // the game camera is orthographic, so sizes are in pixels
      sizeAttenuation: false,
    }));
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 5;
    this.group.add(this.snow);
  }

  private buildFog(count: number) {
    const tex = softDot(128, 'rgba(240,246,255,0.95)', 'rgba(240,246,255,0)');
    for (let i = 0; i < count; i++) {
      const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.22 + this.rnd() * 0.12 }));
      const scale = 9 + this.rnd() * 8;
      s.scale.set(scale, scale * 0.45, 1);
      s.position.set(this.center.x + (this.rnd() - 0.5) * BOX.w, 0.6 + this.rnd() * 2.2, this.center.z + (this.rnd() - 0.5) * BOX.d);
      s.renderOrder = 4;
      this.fog.push({ s, v: new Vector3(0.25 + this.rnd() * 0.35, 0, 0.1 + this.rnd() * 0.2), base: s.position.y });
      this.group.add(s);
    }
  }

  update(dt: number, time: number) {
    const d = Math.min(dt, 0.1) * this.slow;
    if (this.rain) {
      const a = this.rain.geometry.getAttribute('position') as BufferAttribute;
      const pos = a.array as Float32Array;
      for (let i = 0; i < this.vel.length; i++) {
        const k = i * 6;
        pos[k + 1] = pos[k + 1]! - this.vel[i]! * d;
        pos[k] = pos[k]! + 1.2 * d;
        if (pos[k + 1]! < -3) { this.randomIn(pos, k); pos[k + 1] = BOX.h - 2 + this.rnd() * 2; }
        this.streak(pos, i);
      }
      a.needsUpdate = true;
    }
    if (this.snow) {
      const a = this.snow.geometry.getAttribute('position') as BufferAttribute;
      const pos = a.array as Float32Array;
      for (let i = 0; i < this.vel.length; i++) {
        const k = i * 3;
        pos[k + 1] = pos[k + 1]! - (0.55 + (i % 5) * 0.08) * d;
        pos[k] = pos[k]! + (0.25 + Math.sin(time * 0.9 + this.vel[i]!) * 0.35) * d;
        pos[k + 2] = pos[k + 2]! + Math.cos(time * 0.7 + this.vel[i]!) * 0.2 * d;
        if (pos[k + 1]! < -3) { this.randomIn(pos, k); pos[k + 1] = BOX.h - 2; }
      }
      a.needsUpdate = true;
    }
    for (const f of this.fog) {
      f.s.position.addScaledVector(f.v, d);
      f.s.position.y = f.base + Math.sin(time * 0.3 + f.base * 3) * 0.25;
      if (f.s.position.x > this.center.x + BOX.w / 2 + 6) f.s.position.x -= BOX.w + 12;
      if (f.s.position.z > this.center.z + BOX.d / 2 + 6) f.s.position.z -= BOX.d + 12;
    }
  }
}
