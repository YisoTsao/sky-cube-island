import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { TouchGestures, pinchToWheelDelta, TAP_SLOP_PX } from '../../src/ui/touch-gestures';
import { autoQuality } from '../../src/settings/device';
import { CameraRig } from '../../src/scene/camera/camera-rig';

describe('touch gestures', () => {
  it('a short stationary touch is a tap', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100, 0);
    expect(g.move(1, 103, 102)).toEqual([]);
    expect(g.up(1, 103, 102, 120)).toEqual({ x: 103, y: 102 });
  });

  it('dragging one finger pans (and never taps)', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100, 0);
    const first = g.move(1, 100 + TAP_SLOP_PX + 5, 100);
    expect(first).toEqual([{ type: 'pan', dx: TAP_SLOP_PX + 5, dy: 0 }]);
    expect(g.move(1, 130, 110)).toEqual([{ type: 'pan', dx: 130 - (100 + TAP_SLOP_PX + 5), dy: 10 }]);
    expect(g.up(1, 130, 110, 100)).toBeNull();
  });

  it('a long press is not a tap', () => {
    const g = new TouchGestures();
    g.down(1, 50, 50, 0);
    expect(g.up(1, 50, 50, 900)).toBeNull();
  });

  it('pinching out zooms in by the distance ratio and suppresses the tap', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 10);
    const acts = g.move(2, 300, 100);
    const zoom = acts.find((a) => a.type === 'zoom');
    expect(zoom).toEqual({ type: 'zoom', factor: 2 });
    expect(pinchToWheelDelta(2)).toBeLessThan(0); // wheel up = zoom in
    expect(g.up(2, 300, 100, 50)).toBeNull();
    expect(g.up(1, 100, 100, 60)).toBeNull();
  });

  it('twisting two fingers past the threshold requests one 90° turn', () => {
    const g = new TouchGestures();
    g.down(1, 0, 0, 0);
    g.down(2, 100, 0, 0);
    const steps = [15, 30, 45].map((deg) => {
      const r = (deg * Math.PI) / 180;
      return g.move(2, Math.cos(r) * 100, Math.sin(r) * 100);
    });
    const rotates = steps.flat().filter((a) => a.type === 'rotate');
    expect(rotates).toEqual([{ type: 'rotate', dir: 1 }]);
  });

  it('moving both fingers together pans by the midpoint', () => {
    const g = new TouchGestures();
    g.down(1, 0, 0, 0);
    g.down(2, 100, 0, 0);
    g.move(1, 0, 20);
    const acts = g.move(2, 100, 20);
    expect(acts.find((a) => a.type === 'pan')).toEqual({ type: 'pan', dx: 0, dy: 10 });
  });
});

describe('auto quality', () => {
  it('phones default below desktop tiers', () => {
    expect(autoQuality({ cores: 8, memGb: 8, mobile: false })).toBe('high');
    expect(autoQuality({ cores: 4, memGb: 8, mobile: false })).toBe('medium');
    expect(autoQuality({ cores: 8, memGb: 8, mobile: true })).toBe('medium');
    expect(autoQuality({ cores: 4, memGb: 4, mobile: true })).toBe('low');
    expect(autoQuality({ cores: 8, memGb: 2, mobile: true })).toBe('low');
  });
});

describe('camera fit', () => {
  it('widens the frustum on portrait viewports and leaves landscape untouched', () => {
    const rig = new CameraRig(new Vector3(), { minX: -10, maxX: 10, minZ: -10, maxZ: 10 });
    rig.setAspect(16 / 9);
    rig.update(0);
    const landscapeH = rig.camera.top;
    expect(landscapeH).toBeCloseTo(12.5 / 1.15, 3);
    rig.setAspect(390 / 844);
    rig.update(0);
    const portraitW = rig.camera.right;
    expect(rig.camera.top).toBeGreaterThan(landscapeH);
    // at least ~half the landscape width stays visible in portrait
    expect(portraitW).toBeGreaterThan((landscapeH * 16) / 9 / 2);
  });
});
