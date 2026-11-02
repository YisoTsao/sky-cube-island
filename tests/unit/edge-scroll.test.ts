import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { edgeScrollVector, EDGE_ZONE_PX } from '../../src/ui/edge-scroll';
import { CameraRig } from '../../src/scene/camera/camera-rig';

const rect = { left: 0, top: 0, width: 1280, height: 720 };

describe('edge scrolling', () => {
  it('is idle away from the edges and outside the canvas', () => {
    expect(edgeScrollVector(640, 360, rect)).toEqual({ x: 0, y: 0 });
    expect(edgeScrollVector(-5, 360, rect)).toEqual({ x: 0, y: 0 });
    expect(edgeScrollVector(640, 800, rect)).toEqual({ x: 0, y: 0 });
  });

  it('points toward the edge the cursor is on, stronger nearer the edge', () => {
    expect(edgeScrollVector(0, 360, rect).x).toBeCloseTo(-1);
    expect(edgeScrollVector(1280, 360, rect).x).toBeCloseTo(1);
    expect(edgeScrollVector(640, 0, rect).y).toBeCloseTo(1); // top → scroll up
    expect(edgeScrollVector(640, 720, rect).y).toBeCloseTo(-1);
    const near = edgeScrollVector(2, 360, rect).x, far = edgeScrollVector(EDGE_ZONE_PX - 2, 360, rect).x;
    expect(near).toBeLessThan(far);
    expect(far).toBeLessThan(0);
  });

  it('scrolls diagonally in corners', () => {
    const v = edgeScrollVector(1279, 1, rect);
    expect(v.x).toBeGreaterThan(0.9);
    expect(v.y).toBeGreaterThan(0.9);
  });

  it('moves the camera target and stays inside map bounds', () => {
    const bounds = { minX: 1, maxX: 31, minZ: 2, maxZ: 30 };
    const rig = new CameraRig(new Vector3(16, 0.5, 16), bounds, 0);
    const start = rig.target.clone();
    rig.edgeScroll(1, 0, 0.1);
    expect(rig.target.distanceTo(start)).toBeGreaterThan(0.1);
    for (let i = 0; i < 600; i++) rig.edgeScroll(1, 1, 0.05);
    expect(rig.target.x).toBeLessThanOrEqual(bounds.maxX);
    expect(rig.target.x).toBeGreaterThanOrEqual(bounds.minX);
    expect(rig.target.z).toBeLessThanOrEqual(bounds.maxZ);
    expect(rig.target.z).toBeGreaterThanOrEqual(bounds.minZ);
  });
});
