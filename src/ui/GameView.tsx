import { useEffect, useRef } from 'react';
import type { CellId, GameCommand, TowerKind } from '../domain/types';
import { TARGETING_MODES } from '../domain/types';
import { controller, level, runtime, syncStore } from '../app/runtime';
import { SceneApp } from '../scene/scene-app';
import type { QualityLevel } from '../scene/render/pipeline';
import { autoQuality, isMobileDevice } from '../settings/device';
import { useUi } from '../state/store';
import { audio } from '../audio/audio';
import type { Tool } from '../presentation/feed';
import { TouchGestures, pinchToWheelDelta } from './touch-gestures';
import { edgeScrollVector } from './edge-scroll';

const params = new URLSearchParams(location.search);
/** A confirming touch tap within this distance of the previewed cell counts as the same cell. */
const TOUCH_CONFIRM_RADIUS_PX = 26;

export function resolveQuality(q: string): QualityLevel {
  const forced = params.get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high' || forced === 'ultra') return forced;
  if (q !== 'auto') return q as QualityLevel;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  return autoQuality({ cores, memGb: mem, mobile: isMobileDevice() });
}

/** Command helper with consistent feedback (toast + illegal flash + sfx). */
export function issue(cmd: GameCommand, cells: CellId[] = []): boolean {
  const r = controller.dispatch(cmd);
  const ui = useUi.getState();
  if (!r.ok) {
    ui.toast(`✕ ${r.message}（未扣金幣）`, 'error');
    runtime.scene?.flashIllegal(cells);
    audio.play('illegal');
    return false;
  }
  syncStore();
  return true;
}

export function setTool(tool: Tool) {
  const ui = useUi.getState();
  if (tool.type !== 'none' && !toolAllowed(ui.phase, tool)) {
    ui.toast(ui.phase === 'COMBAT' ? '戰鬥中只能建造、升級或出售防禦塔' : '只能在準備階段建造或改造地形', 'error');
    return;
  }
  const same = ui.tool.type === tool.type && (tool.type !== 'build' || (ui.tool.type === 'build' && ui.tool.kind === tool.kind));
  const next = same ? { type: 'none' as const } : tool;
  ui.set({ tool: next, preview: null, selection: next.type === 'none' ? ui.selection : null });
  runtime.scene?.setPreview(null);
  runtime.scene?.setSelection(null);
  audio.play('click');
  const hover = ui.hover?.cellId ?? null;
  if (next.type !== 'none' && hover) refreshPreview(hover);
}

/** Terrain and walls are PREPARE-only; towers can also be built during COMBAT. */
export function toolAllowed(phase: string, tool: Tool): boolean {
  if (phase === 'PREPARE') return true;
  return phase === 'COMBAT' && tool.type === 'build';
}

function refreshPreview(cellId: CellId | null) {
  const ui = useUi.getState();
  const p = toolAllowed(ui.phase, ui.tool) ? controller.preview(ui.tool, cellId) : null;
  ui.set({ preview: p });
  runtime.scene?.setPreview(p);
}

export function startWave() {
  const ui = useUi.getState();
  if (ui.phase !== 'PREPARE') return;
  ui.set({ tool: { type: 'none' }, preview: null, selection: null });
  runtime.scene?.setPreview(null);
  runtime.scene?.setSelection(null);
  issue({ type: 'START_WAVE' });
}

function sharedRuneSnap(scene: SceneApp) { scene.snapRune(); }

export function GameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ui = useUi.getState();
    const quality = resolveQuality(ui.settings.quality);
    const scene = new SceneApp(canvas, controller, {
      quality,
      reducedMotion: ui.settings.reducedMotion,
      screenShake: ui.settings.screenShake,
      damageNumbers: ui.settings.damageNumbers,
      colorblind: ui.settings.colorblindSafe,
      dynamicResolution: ui.settings.dynamicResolution,
      visualTest: params.has('visualTest'),
    });
    runtime.scene = scene;
    ui.set({ qualityLabel: quality });
    const camTurns = Number(params.get('cam') ?? 0);
    for (let i = 0; i < camTurns; i++) scene.rig.rotate(1);
    scene.hooks = {
      onCoins: (screen, amount) => {
        const el = document.createElement('div');
        el.className = 'coin-fly';
        el.style.left = `${screen.x}px`; el.style.top = `${screen.y}px`;
        el.textContent = amount > 0 ? `+${amount}` : '';
        const target = document.querySelector('.hud-gold')?.getBoundingClientRect();
        if (target) {
          el.style.setProperty('--tx', `${target.left + 20 - screen.x}px`);
          el.style.setProperty('--ty', `${target.top + 14 - screen.y}px`);
        }
        document.body.appendChild(el);
        setTimeout(() => { el.remove(); const u = useUi.getState(); u.set({ coinPulse: u.coinPulse + 1 }); audio.play('coin'); }, 650);
      },
    };
    const resize = () => scene.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    syncStore();
    if (!params.has('visualTest') && !params.has('nointro')) {
      scene.playIntro();
      useUi.getState().set({ introPlaying: true });
    }

    // ---- edge scrolling (desktop mouse) ----------------------------------------
    // Tracked on window so HUD panels near the edge don't swallow it; buttons and open menus
    // suppress it so reaching for a HUD control doesn't drift the map.
    const edgeMouse = { x: 0, y: 0, inside: false, overUi: false };
    const edgeScrollStep = (dt: number) => {
      const u = useUi.getState();
      if (!edgeMouse.inside || edgeMouse.overUi || dragging || u.touchUi || !u.settings.edgeScroll) return;
      if (scene.introPlaying || u.pauseOpen || u.settingsOpen || u.helpOpen || !document.hasFocus()) return;
      const v = edgeScrollVector(edgeMouse.x, edgeMouse.y, canvas.getBoundingClientRect());
      scene.rig.edgeScroll(v.x, v.y, dt);
    };
    const onWindowMove = (ev: PointerEvent) => {
      if (ev.pointerType !== 'mouse') { edgeMouse.inside = false; return; }
      edgeMouse.x = ev.clientX; edgeMouse.y = ev.clientY; edgeMouse.inside = true;
      edgeMouse.overUi = !!(ev.target as Element | null)?.closest?.('button, input, select, textarea, a, .modal-wrap');
    };
    const onWindowLeave = (ev: MouseEvent) => { if (!ev.relatedTarget) edgeMouse.inside = false; };
    const onWindowBlur = () => { edgeMouse.inside = false; };

    // ---- main loop -------------------------------------------------------------
    let last = performance.now();
    let raf = 0;
    let perfAcc = 0;
    const showPerf = params.has('perf');
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      const frameMs = now - last;
      last = now;
      controller.update(dt);
      edgeScrollStep(dt);
      scene.frame(dt, frameMs, now);
      if (useUi.getState().introPlaying && !scene.introPlaying) useUi.getState().set({ introPlaying: false });
      // portal preview cards follow their portals (2 DOM nodes only)
      const cards = cardsRef.current;
      if (cards) {
        for (const el of Array.from(cards.children) as HTMLElement[]) {
          const s = scene.portalScreen(el.dataset.portal!);
          if (s) el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
        }
      }
      if (showPerf && (perfAcc += dt) > 0.5) { perfAcc = 0; useUi.getState().set({ perf: scene.perfInfo() }); }
    };
    raf = requestAnimationFrame(loop);

    // ---- input -------------------------------------------------------------------
    // Mouse: hover previews, left click places/selects, middle or shift-drag pans, right click cancels.
    // Touch: tap selects; with a tool held, the first tap previews a cell and a second tap on the
    // same cell confirms (no hover on phones). One-finger drag pans, pinch zooms, twist rotates.
    let dragging: { x: number; y: number; moved: boolean } | null = null;
    let lastHoverCell: CellId | null = null;
    let pendingTouchCell: CellId | null = null;
    const gestures = new TouchGestures();
    const isTouch = (ev: PointerEvent) => ev.pointerType === 'touch' || ev.pointerType === 'pen';
    const markInput = (touch: boolean) => { if (useUi.getState().touchUi !== touch) useUi.getState().set({ touchUi: touch }); };

    const setHoverCell = (cellId: CellId | null) => {
      lastHoverCell = cellId;
      scene.setHover(cellId);
      const u = useUi.getState();
      if (cellId) {
        const c = level.cells.find((x) => x.id === cellId)!;
        const platform = level.platforms.find((p) => p.id === c.platformId)?.name ?? level.connectors.find((x) => x.id === c.platformId)?.name ?? '';
        u.set({ hover: { cellId, platform, elevation: controller.elevationOf(cellId), kind: c.kind, editable: c.editable, buildable: c.buildable } });
      } else u.set({ hover: null });
      if (u.tool.type !== 'none') refreshPreview(cellId);
    };

    const onMove = (ev: PointerEvent) => {
      if (isTouch(ev)) {
        for (const a of gestures.move(ev.pointerId, ev.clientX, ev.clientY)) {
          if (a.type === 'pan') scene.rig.pan(a.dx, a.dy, canvas.clientHeight);
          else if (a.type === 'zoom') scene.rig.zoomBy(pinchToWheelDelta(a.factor));
          else scene.rig.rotate(a.dir);
        }
        return;
      }
      if (dragging) {
        const dx = ev.clientX - dragging.x, dy = ev.clientY - dragging.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragging.moved = true;
        scene.rig.pan(dx, dy, canvas.clientHeight);
        dragging.x = ev.clientX; dragging.y = ev.clientY;
        return;
      }
      const hit = scene.pick(ev.clientX, ev.clientY);
      if (hit.cellId === lastHoverCell) return;
      setHoverCell(hit.cellId);
    };

    /** Primary action at a screen point (mouse left click, or a confirmed touch tap). */
    const primaryAt = (x: number, y: number, touch: boolean) => {
      const u = useUi.getState();
      const hit = scene.pick(x, y);
      if (u.tool.type !== 'none' && toolAllowed(u.phase, u.tool)) {
        let cellId = hit.cellId;
        if (touch && pendingTouchCell && cellId !== pendingTouchCell) {
          // fingers are imprecise on small tiles: a confirm tap anywhere on the previewed footprint,
          // or within a finger's width of the previewed cell, counts as the same cell
          const s = scene.worldToScreen(scene.cellWorld(pendingTouchCell));
          if ((cellId && u.preview?.cellIds?.includes(cellId)) || Math.hypot(s.x - x, s.y - y) <= TOUCH_CONFIRM_RADIUS_PX) cellId = pendingTouchCell;
        }
        if (!cellId) { if (touch) { pendingTouchCell = null; setHoverCell(null); } return; }
        if (touch && pendingTouchCell !== cellId) {
          // first tap: show the placement preview (cost, legality, new routes) — nothing is spent yet
          pendingTouchCell = cellId;
          setHoverCell(cellId);
          audio.play('click', { vol: 0.4 });
          return;
        }
        const t = u.tool;
        const p = controller.preview(t, cellId);
        const cells = p?.cellIds ?? [cellId];
        let ok: boolean;
        if (t.type === 'build') ok = issue({ type: 'BUILD_TOWER', kind: t.kind, anchorCellId: cellId }, cells);
        else if (t.type === 'wall') ok = issue({ type: 'PLACE_WALL', cellId }, cells);
        else {
          const cur = controller.elevationOf(cellId);
          ok = issue({ type: 'SET_ELEVATION', cellId, next: (t.type === 'raise' ? cur + 1 : cur - 1) as never }, cells);
        }
        if (ok && t.type === 'build') {
          const id = controller.state.towers[controller.state.towers.length - 1]!.id;
          pendingTouchCell = null;
          u.set({ tool: { type: 'none' }, preview: null, selection: { type: 'tower', id } });
          scene.setPreview(null);
          scene.setSelection({ type: 'tower', id });
          if (u.tutorialStep < 2) u.set({ tutorialStep: 2 });
        } else if (touch) setHoverCell(cellId); // terrain tools: further taps on the same cell repeat
        else refreshPreview(cellId);
        return;
      }
      pendingTouchCell = null;
      if (touch) setHoverCell(hit.cellId);
      if (hit.towerId) {
        u.set({ selection: { type: 'tower', id: hit.towerId } });
        scene.setSelection({ type: 'tower', id: hit.towerId });
      } else if (hit.wallId) {
        const w = controller.state.walls.find((x) => x.id === hit.wallId)!;
        u.set({ selection: { type: 'wall', id: w.id, cellId: w.cellId } });
        scene.setSelection({ type: 'wall', id: w.id });
      } else if (hit.cellId) {
        const tower = controller.state.towers.find((t) => t.footprintCellIds.includes(hit.cellId!));
        const wall = controller.state.walls.find((w) => w.cellId === hit.cellId);
        if (tower) { u.set({ selection: { type: 'tower', id: tower.id } }); scene.setSelection({ type: 'tower', id: tower.id }); }
        else if (wall) { u.set({ selection: { type: 'wall', id: wall.id, cellId: wall.cellId } }); scene.setSelection({ type: 'wall', id: wall.id }); }
        else { u.set({ selection: { type: 'cell', cellId: hit.cellId } }); scene.setSelection({ type: 'cell', id: hit.cellId }); }
      } else {
        u.set({ selection: null }); scene.setSelection(null);
      }
      audio.play('click', { vol: 0.5 });
    };

    const onDown = (ev: PointerEvent) => {
      audio.unlock();
      const touch = isTouch(ev);
      markInput(touch);
      if (scene.introPlaying) { scene.skipIntro(); useUi.getState().set({ introPlaying: false }); if (touch) return; }
      if (touch) {
        gestures.down(ev.pointerId, ev.clientX, ev.clientY, ev.timeStamp);
        canvas.setPointerCapture(ev.pointerId);
        ev.preventDefault();
        return;
      }
      if (ev.button === 1 || (ev.button === 0 && ev.shiftKey)) {
        dragging = { x: ev.clientX, y: ev.clientY, moved: false };
        canvas.setPointerCapture(ev.pointerId);
        ev.preventDefault();
        return;
      }
      if (ev.button === 2) {
        const u = useUi.getState();
        u.set({ tool: { type: 'none' }, preview: null, selection: null });
        scene.setPreview(null); scene.setSelection(null);
        return;
      }
      if (ev.button !== 0) return;
      primaryAt(ev.clientX, ev.clientY, false);
    };
    const onUp = (ev: PointerEvent) => {
      if (isTouch(ev)) {
        const tap = gestures.up(ev.pointerId, ev.clientX, ev.clientY, ev.timeStamp);
        if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
        if (tap) primaryAt(tap.x, tap.y, true);
        return;
      }
      if (dragging) { dragging = null; canvas.releasePointerCapture(ev.pointerId); }
    };
    const onCancel = (ev: PointerEvent) => { if (isTouch(ev)) gestures.cancel(ev.pointerId); else dragging = null; };
    // a new tool (or none) invalidates a half-confirmed touch placement
    const unsubTool = useUi.subscribe((s, prev) => {
      if (s.tool !== prev.tool) pendingTouchCell = null;
      // a tool that the new phase does not allow (e.g. a tower tool when the wave ends) is dropped
      if (s.phase !== prev.phase && s.tool.type !== 'none' && !toolAllowed(s.phase, s.tool)) {
        s.set({ tool: { type: 'none' }, preview: null });
        scene.setPreview(null);
      }
    });
    const onWheel = (ev: WheelEvent) => { ev.preventDefault(); scene.rig.zoomBy(ev.deltaY); };
    const onContext = (ev: Event) => ev.preventDefault();

    const keysDown = new Set<string>();
    const onKey = (ev: KeyboardEvent) => {
      const u = useUi.getState();
      markInput(false);
      if ((ev.target as HTMLElement)?.tagName === 'INPUT') return;
      audio.unlock();
      if (scene.introPlaying) { scene.skipIntro(); u.set({ introPlaying: false }); return; }
      const k = ev.key.toLowerCase();
      if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.preventDefault(); issue({ type: 'UNDO_PREPARE' }); return; }
      if (k === 'tab') { ev.preventDefault(); if (!u.showAllRanges) { u.set({ showAllRanges: true }); scene.setShowAllRanges(true); } return; }
      if (keysDown.has(k)) return;
      keysDown.add(k);
      const towerKeys: Record<string, TowerKind> = { '1': 'arrow', '2': 'frost', '3': 'cannon', '4': 'lightning', '5': 'wind' };
      if (towerKeys[k]) setTool({ type: 'build', kind: towerKeys[k]! });
      else if (k === 't') {
        // cycle the selected tower's targeting mode
        const sel = u.selection;
        const tw = sel?.type === 'tower' ? controller.state.towers.find((x) => x.id === sel.id) : undefined;
        if (tw) issue({ type: 'SET_TARGETING', towerId: tw.id, targeting: TARGETING_MODES[(TARGETING_MODES.indexOf(tw.targeting) + 1) % TARGETING_MODES.length]! });
      }
      else if (k === 'r') setTool({ type: 'raise' });
      else if (k === 'f') setTool({ type: 'lower' });
      else if (k === 'b') setTool({ type: 'wall' });
      else if (k === 'q') scene.rig.rotate(-1);
      else if (k === 'e') scene.rig.rotate(1);
      else if (k === '=' || k === '+') scene.rig.zoomStep(1);
      else if (k === '-') scene.rig.zoomStep(-1);
      else if (k === ' ') {
        ev.preventDefault();
        if (u.phase === 'COMBAT') { controller.flags.paused = !controller.flags.paused; syncStore(); }
      } else if (k === 'enter') {
        if (u.phase === 'PREPARE') startWave();
        else if (u.phase === 'WAVE_RESULT') issue({ type: 'CONTINUE' });
      } else if (k === 'escape') {
        if (u.tool.type !== 'none' || u.preview) { u.set({ tool: { type: 'none' }, preview: null }); scene.setPreview(null); }
        else if (u.selection) { u.set({ selection: null }); scene.setSelection(null); }
        else { const open = !u.pauseOpen; u.set({ pauseOpen: open }); if (u.phase === 'COMBAT') { controller.flags.paused = open; syncStore(); } }
      } else if (k === 'x' && u.selection?.type === 'tower' && (u.phase === 'PREPARE' || u.phase === 'COMBAT')) {
        issue({ type: 'SELL_TOWER', towerId: u.selection.id });
        u.set({ selection: null }); scene.setSelection(null);
      } else if (k === 'u' && u.selection?.type === 'tower' && (u.phase === 'PREPARE' || u.phase === 'COMBAT')) {
        issue({ type: 'UPGRADE_TOWER', towerId: u.selection.id });
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      const k = ev.key.toLowerCase();
      keysDown.delete(k);
      if (k === 'tab') { useUi.getState().set({ showAllRanges: false }); scene.setShowAllRanges(false); }
    };
    const panKeys = setInterval(() => {
      const sp = 0.35;
      if (keysDown.has('w') || keysDown.has('arrowup')) scene.rig.panWorld(0, sp);
      if (keysDown.has('s') || keysDown.has('arrowdown')) scene.rig.panWorld(0, -sp);
      if (keysDown.has('a') || keysDown.has('arrowleft')) scene.rig.panWorld(-sp, 0);
      if (keysDown.has('d') || keysDown.has('arrowright')) scene.rig.panWorld(sp, 0);
    }, 16);

    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointermove', onWindowMove);
    document.addEventListener('mouseout', onWindowLeave);
    window.addEventListener('blur', onWindowBlur);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    const runeFor = (s: { phase: string; tool: Tool }) => s.phase !== 'PREPARE' ? 0 : s.tool.type === 'raise' || s.tool.type === 'lower' ? 1 : s.tool.type === 'none' ? 0.3 : 0.15;
    scene.setRuneEmphasis(runeFor(useUi.getState()));
    if (params.has('visualTest')) sharedRuneSnap(scene);
    const unsub = useUi.subscribe((s, prev) => {
      if (s.tool !== prev.tool || s.phase !== prev.phase) scene.setRuneEmphasis(runeFor(s));
      if (s.settings !== prev.settings) {
        const q = resolveQuality(s.settings.quality);
        scene.applyOptions({
          quality: q, reducedMotion: s.settings.reducedMotion, screenShake: s.settings.screenShake,
          damageNumbers: s.settings.damageNumbers, colorblind: s.settings.colorblindSafe, dynamicResolution: s.settings.dynamicResolution,
        });
        if (q !== s.qualityLabel) useUi.getState().set({ qualityLabel: q });
        audio.setVolumes(s.settings.volume);
      }
    });
    (window as unknown as { __sky: unknown }).__sky = { controller, scene, useUi };
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(panKeys);
      ro.disconnect();
      unsub();
      canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointermove', onWindowMove);
      document.removeEventListener('mouseout', onWindowLeave);
      window.removeEventListener('blur', onWindowBlur);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      unsubTool();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      scene.dispose();
      runtime.scene = null;
    };
  }, []);

  const preview = useUi((s) => s.wavePreview);
  const phase = useUi((s) => s.phase);
  return (
    <div className="game-view">
      <canvas ref={canvasRef} className="game-canvas" />
      <div ref={cardsRef} className="portal-cards" style={{ display: phase === 'PREPARE' ? undefined : 'none' }}>
        {level.portals.map((p) => (
          <PortalCard key={p.id} portalId={p.id} counts={preview[p.id]} />
        ))}
      </div>
    </div>
  );
}

import { EnemyIcon } from './icons';
function PortalCard({ portalId, counts }: { portalId: string; counts?: Record<string, number> }) {
  const entries = Object.entries(counts ?? {});
  return (
    <div className={`portal-card portal-${portalId}`} data-portal={portalId}>
      <div className="portal-card-title">入口 {portalId}</div>
      {entries.length ? (
        <div className="portal-card-row">
          {entries.map(([k, n]) => (
            <span key={k} className="portal-card-enemy"><EnemyIcon kind={k as never} size={20} />×{n}</span>
          ))}
        </div>
      ) : <div className="portal-card-empty">本波無敵人</div>}
    </div>
  );
}
