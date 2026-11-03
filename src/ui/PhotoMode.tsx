import { MathUtils } from 'three';
import { controller, level, runtime, syncStore } from '../app/runtime';
import { useUi, type PhotoState } from '../state/store';
import { audio } from '../audio/audio';
import { PHOTO_FILTERS } from '../scene/render/pipeline';

/**
 * Photo mode (GDD §11.4 / §12 「P 拍照模式」, T1): hides the HUD, pauses the battle, frees the
 * camera (any yaw, 18°–80° pitch, wider zoom), offers filters + tilt-shift and saves a PNG.
 * Presentation only: never issues a command and puts the tactical camera back on exit.
 */

const DEFAULT_PHOTO: PhotoState = { filter: 0, tiltShift: 0.55, focus: 0.5, hideTactical: true, orbit: false };
let saved: { view: ReturnType<NonNullable<typeof runtime.scene>['rig']['getView']>; paused: boolean } | null = null;

export function photoActive(): boolean { return !!useUi.getState().photo; }

export function enterPhoto() {
  const scene = runtime.scene;
  const u = useUi.getState();
  if (!scene || u.photo || u.screen !== 'game') return;
  if (scene.introPlaying) { scene.skipIntro(); u.set({ introPlaying: false }); }
  saved = { view: scene.rig.getView(), paused: controller.flags.paused };
  controller.flags.paused = true;
  u.set({ photo: { ...DEFAULT_PHOTO }, tool: { type: 'none' }, preview: null, selection: null, pauseOpen: false, showAllRanges: false });
  scene.setPreview(null); scene.setSelection(null); scene.setShowAllRanges(false);
  scene.setPhotoMode(true);
  scene.setPhotoLook(DEFAULT_PHOTO);
  syncStore();
  audio.play('click');
}

export function exitPhoto() {
  const scene = runtime.scene;
  const u = useUi.getState();
  if (!u.photo) return;
  u.set({ photo: null });
  if (scene) {
    scene.setPhotoMode(false);
    if (saved) scene.rig.setView(saved.view);
  }
  controller.flags.paused = saved?.paused ?? false;
  saved = null;
  syncStore();
  audio.play('click');
}

export function togglePhoto() { if (photoActive()) exitPhoto(); else enterPhoto(); }

export function updatePhoto(p: Partial<PhotoState>) {
  const u = useUi.getState();
  if (!u.photo) return;
  const next = { ...u.photo, ...p };
  u.set({ photo: next });
  runtime.scene?.setPhotoLook(next);
}

/** Photo-mode keys; returns true when the key was consumed. */
export function photoKey(k: string): boolean {
  const scene = runtime.scene;
  if (!photoActive() || !scene) return false;
  const deg = MathUtils.degToRad(15);
  if (k === 'p' || k === 'escape') exitPhoto();
  else if (k === 'q') scene.rig.rotateBy(-deg);
  else if (k === 'e') scene.rig.rotateBy(deg);
  else if (k === 'r') scene.rig.setPitch(scene.rig.pitch + MathUtils.degToRad(5));
  else if (k === 'f') scene.rig.setPitch(scene.rig.pitch - MathUtils.degToRad(5));
  else if (k === 'h') updatePhoto({ hideTactical: !useUi.getState().photo!.hideTactical });
  else if (k === 'enter' || k === 'c') void takePhoto();
  else if (k === '=' || k === '+') scene.rig.zoomBy(-200);
  else if (k === '-') scene.rig.zoomBy(200);
  else if (/^[1-6]$/.test(k)) updatePhoto({ filter: Number(k) - 1 });
  else return k === ' ' || k === 'tab' || k === 'b' || k === 'u' || k === 'x' || k === 't' || /^[0-9]$/.test(k);
  return true;
}

/** Drag in photo mode: horizontal = orbit, vertical = tilt. */
export function photoDrag(dx: number, dy: number) {
  const rig = runtime.scene?.rig;
  if (!rig) return;
  rig.turn(-dx * 0.006);
  rig.setPitch(rig.pitch + dy * 0.004);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Capture the canvas and hand it to the player (share sheet on phones, download elsewhere). */
export async function takePhoto(): Promise<string | null> {
  const scene = runtime.scene;
  if (!scene) return null;
  const url = scene.capture();
  const name = `sky-cube-island-${level.id}-${stamp()}.png`;
  useUi.getState().set({ photoFlash: (useUi.getState().photoFlash ?? 0) + 1 });
  audio.play('upgrade', { vol: 0.5 });
  try {
    const nav = navigator as Navigator & { canShare?(d: unknown): boolean };
    if (useUi.getState().touchUi && nav.canShare && typeof File !== 'undefined') {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], name, { type: 'image/png' });
      if (nav.canShare({ files: [file] })) { await nav.share({ files: [file], title: '天空方塊島' }); return url; }
    }
  } catch { /* share cancelled or unsupported → fall back to download */ }
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  useUi.getState().toast('已儲存截圖', 'success');
  return url;
}

export function PhotoPanel() {
  const photo = useUi((s) => s.photo);
  const touch = useUi((s) => s.touchUi);
  const flash = useUi((s) => s.photoFlash);
  if (!photo) return null;
  const rig = runtime.scene?.rig;
  return (
    <>
      {flash > 0 && <div key={flash} className="photo-flash" />}
      <div className="photo-top panel">
        <b>拍照模式</b>
        <span className="photo-hint">{touch ? '拖曳平移 · 雙指縮放 · 用下方按鈕旋轉與傾斜' : '左鍵拖曳旋轉／傾斜 · 中鍵拖曳平移 · 滾輪縮放 · Q/E 旋轉 · R/F 傾斜 · Enter 拍照 · P/Esc 離開'}</span>
        <button className="btn ghost" onClick={exitPhoto}>離開</button>
      </div>
      <div className="photo-dock panel">
        <div className="photo-row photo-filters" role="group" aria-label="濾鏡">
          {PHOTO_FILTERS.map((name, i) => (
            <button key={name} className={`chip ${photo.filter === i ? 'on' : ''}`} onClick={() => updatePhoto({ filter: i })}>{name}</button>
          ))}
        </div>
        <div className="photo-row">
          <label className="photo-slider">移軸
            <input type="range" min={0} max={1} step={0.05} value={photo.tiltShift} onChange={(e) => updatePhoto({ tiltShift: Number(e.target.value) })} />
          </label>
          <label className="photo-slider">焦點
            <input type="range" min={0.2} max={0.8} step={0.02} value={1 - photo.focus} onChange={(e) => updatePhoto({ focus: 1 - Number(e.target.value) })} />
          </label>
        </div>
        <div className="photo-row">
          <button className="chip" title="向左轉 15°" onClick={() => rig?.rotateBy(-Math.PI / 12)}>⟲ 轉</button>
          <button className="chip" title="向右轉 15°" onClick={() => rig?.rotateBy(Math.PI / 12)}>轉 ⟳</button>
          <button className="chip" title="視角抬高" onClick={() => rig?.setPitch(rig.pitch + Math.PI / 36)}>俯視 ▲</button>
          <button className="chip" title="視角放低" onClick={() => rig?.setPitch(rig.pitch - Math.PI / 36)}>平視 ▼</button>
          <button className={`chip ${photo.orbit ? 'on' : ''}`} onClick={() => updatePhoto({ orbit: !photo.orbit })}>環繞</button>
          <button className={`chip ${photo.hideTactical ? '' : 'on'}`} onClick={() => updatePhoto({ hideTactical: !photo.hideTactical })}>戰術線</button>
          <button className="btn primary photo-shoot" onClick={() => void takePhoto()}>📷 拍照</button>
        </div>
      </div>
    </>
  );
}
