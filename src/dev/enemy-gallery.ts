/**
 * Dev-only enemy lineup (`npm run dev` → /enemy-gallery.html). Renders every enemy model
 * side by side under the day light rig so model changes can be compared in screenshots.
 * Not part of the production build (only index.html is a build input).
 */
import {
  AmbientLight, BoxGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, PCFSoftShadowMap,
} from 'three';
import { ENEMY_KINDS, type EnemyKind } from '../domain/types';
import { ENEMY_DEFS } from '../domain/definitions';
import { EnemyView } from '../scene/entities';
import { sharedUniforms } from '../scene/materials/voxel-material';

const params = new URLSearchParams(location.search);
const kinds = (params.get('kinds')?.split(',') as EnemyKind[] | undefined) ?? [...ENEMY_KINDS];
const cols = Number(params.get('cols') ?? 6);
const zoom = Number(params.get('zoom') ?? 1);
const animate = params.has('animate');
const detail = params.get('detail') === 'low' ? 'low' : 'high';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x9fd0ff);
scene.add(new HemisphereLight(0xcfe6ff, 0x8aa66a, 0.75));
scene.add(new AmbientLight(0xffffff, 0.08));
const sun = new DirectionalLight(0xffefd2, 2.65);
sun.position.set(-6, 14, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const gap = Number(params.get('gap') ?? 2.7);
const rows = Math.ceil(kinds.length / cols);
const ground = new Mesh(new BoxGeometry(cols * gap + 1, 0.2, rows * gap + 1), new MeshStandardMaterial({ color: 0x84c95c, roughness: 0.95 }));
ground.position.y = -0.1;
ground.receiveShadow = true;
scene.add(ground);

const views: EnemyView[] = [];
const labels = document.getElementById('labels')!;
const anchors: { el: HTMLDivElement; p: Vector3 }[] = [];
kinds.forEach((k, i) => {
  const v = new EnemyView(`g${i}`, k, 0, detail);
  const cx = (i % cols - (cols - 1) / 2) * gap;
  const cz = (Math.floor(i / cols) - (rows - 1) / 2) * gap;
  v.group.position.set(cx, 0, cz);
  v.group.rotation.y = Number(params.get('yaw') ?? -0.45);
  if (!animate) (v as unknown as { t: number }).t = 0; // neutral pose (wings level)
  scene.add(v.group);
  views.push(v);
  const el = document.createElement('div');
  el.textContent = `${ENEMY_DEFS[k].name} (${k})`;
  labels.appendChild(el);
  anchors.push({ el, p: new Vector3(cx, -0.05, cz + gap * 0.42) });
});

const camera = new PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);
// fit the grid width (and depth) into the view at a ~36° pitch, like the in-game camera
const halfW = (cols * gap) / 2 * 0.92, halfD = (rows * gap) / 2 + 0.6;
const tanV = Math.tan((camera.fov / 2) * Math.PI / 180);
const dist = Math.max(halfW / (tanV * camera.aspect), (halfD * 1.25) / tanV) / zoom;
const pitch = Number(params.get('pitch') ?? 36) * Math.PI / 180;
camera.position.set(0, 0.5 + Math.sin(pitch) * dist, Math.cos(pitch) * dist);
camera.lookAt(0, 0.5, 0);

let last = performance.now();
let t = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  sharedUniforms.uTime.value = t;
  for (const v of views) v.update(animate ? dt : 0, animate, 1);
  renderer.render(scene, camera);
  for (const a of anchors) {
    const s = a.p.clone().project(camera);
    a.el.style.left = `${(s.x * 0.5 + 0.5) * innerWidth}px`;
    a.el.style.top = `${(-s.y * 0.5 + 0.5) * innerHeight}px`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __galleryReady: boolean }).__galleryReady = true;
