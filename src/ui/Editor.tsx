import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EnemyKind, LevelDef } from '../domain/types';
import { ENEMY_DEFS } from '../domain/definitions';
import { computeRoutes } from '../navigation/connectivity';
import {
  buildCustomLevel, defaultCustomSpec, deleteCustom, encodeCustom, loadSavedCustom, registerCustom, saveCustom,
  type CustomSpec, type SavedCustom,
  findValidSeed,
} from '../levels/custom';
import type { CellOverride, Corner, Side } from '../levels/procgen';
import { useUi } from '../state/store';
import { audio } from '../audio/audio';
import { launchLevel } from './launch';
import { EnemyIcon } from './icons';

/**
 * Level editor (GDD §16 T3「關卡編輯器與分享」). The player shapes an island with the generator's
 * knobs (islands, portals, bridges, roster, difficulty) and then paints individual cells on the
 * map; the result is validated live and can be played, saved locally or shared as a link.
 */

const SIDES: Side[] = ['N', 'E', 'S', 'W'];
const SIDE_NAME: Record<Side, string> = { N: '北', E: '東', S: '南', W: '西' };
const CORNERS: Corner[] = ['NE', 'SE', 'SW', 'NW'];
const CORNER_NAME: Record<Corner, string> = { NE: '東北', SE: '東南', SW: '西南', NW: '西北' };
const NORMAL_KINDS = (Object.keys(ENEMY_DEFS) as EnemyKind[]).filter((k) => ENEMY_DEFS[k].hp < 1000);
const BOSS_KINDS = (Object.keys(ENEMY_DEFS) as EnemyKind[]).filter((k) => ENEMY_DEFS[k].hp >= 1000);
const THEMES = [['day', '晴空'], ['dusk', '黃昏'], ['snow', '雪地'], ['ember', '熔岩']] as const;
const WEATHERS = [['clear', '晴天'], ['rain', '微雨'], ['snow', '飄雪'], ['fog', '霧天']] as const;
type PaintTool = CellOverride | 'reset';
const TOOLS: [PaintTool, string][] = [['raise', '抬高'], ['pillar', '石柱'], ['void', '挖空'], ['ground', '補地'], ['reset', '還原']];

const ERROR_TEXT: [RegExp, string][] = [
  [/initial route check failed/, '有入口走不到核心'],
  [/portal .* missing cell|portal .* must be on ground/, '有傳送門所在的地塊被挖掉了'],
  [/connector .* endpoints must be ground|connector .* references missing/, '橋頭的地塊被挖掉了'],
  [/approach/, '核心旁的接近點被改壞了'],
  [/core footprint/, '核心底座被改壞了'],
];
const explain = (errors: string[]) => [...new Set(errors.map((e) => ERROR_TEXT.find(([re]) => re.test(e))?.[1] ?? e))].slice(0, 4);

function MapCanvas({ level, overrides, onPaint }: { level: LevelDef | null; overrides: Record<string, CellOverride>; onPaint(x: number, z: number): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const routes = useMemo(() => {
    if (!level) return new Set<string>();
    const r = computeRoutes(level, { editedElevations: {}, towers: [], walls: [] });
    return new Set(r.ok ? Object.values(r.routes).flat() : []);
  }, [level]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext('2d')!;
    const N = 32, s = cv.width / N;
    g.fillStyle = '#2d3e5c';
    g.fillRect(0, 0, cv.width, cv.height);
    if (!level) return;
    const portals = new Set(level.portals.map((p) => p.cellId));
    const core = new Set(level.core.footprintCellIds);
    const base = level.theme === 'snow' ? [226, 236, 246] : level.theme === 'ember' ? [120, 92, 82] : level.theme === 'dusk' ? [140, 186, 110] : [120, 196, 96];
    for (const c of level.cells) {
      const x = c.pos.x * s, y = c.pos.z * s;
      let col: string;
      if (c.kind !== 'ground') col = '#a8743f';
      else if (c.tags?.includes('pillar')) col = '#5b5f6b';
      else {
        const k = 0.72 + c.elevation * 0.07;
        col = `rgb(${base.map((v) => Math.min(255, Math.round(v * k))).join(',')})`;
      }
      g.fillStyle = col;
      g.fillRect(x + 0.5, y + 0.5, s - 1, s - 1);
      if (core.has(c.id)) { g.fillStyle = '#5fe0ff'; g.fillRect(x + 2, y + 2, s - 4, s - 4); }
      if (portals.has(c.id)) { g.fillStyle = '#9b5cff'; g.beginPath(); g.arc(x + s / 2, y + s / 2, s * 0.42, 0, Math.PI * 2); g.fill(); }
      if (routes.has(c.id) && !portals.has(c.id) && !core.has(c.id)) { g.fillStyle = 'rgba(255,240,140,.9)'; g.fillRect(x + s * 0.38, y + s * 0.38, s * 0.24, s * 0.24); }
    }
    g.strokeStyle = '#ff6a8a';
    g.lineWidth = 1.5;
    for (const k of Object.keys(overrides)) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      g.strokeRect(x * s + 1.5, z * s + 1.5, s - 3, s - 3);
    }
  }, [level, overrides, routes]);
  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * 32), Math.floor(((e.clientY - r.top) / r.height) * 32)] as const;
  };
  const last = useRef('');
  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, z] = cellAt(e);
    const k = `${x},${z}`;
    if (k === last.current) return;
    last.current = k;
    onPaint(x, z);
  };
  return (
    <canvas
      ref={ref} width={512} height={512} className="editor-map" aria-label="地圖（點擊或拖曳以修改地塊）"
      onPointerDown={(e) => { painting.current = true; last.current = ''; e.currentTarget.setPointerCapture(e.pointerId); paint(e); }}
      onPointerMove={(e) => { if (painting.current) paint(e); }}
      onPointerUp={() => { painting.current = false; }}
      onPointerCancel={() => { painting.current = false; }}
    />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ed-row"><span className="ed-label">{label}</span><div className="ed-ctrl">{children}</div></div>;
}
function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange(v: T): void }) {
  return <div className="seg">{options.map(([v, l]) => <button key={String(v)} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
function Chip({ on, onClick, children, disabled }: { on: boolean; onClick(): void; children: ReactNode; disabled?: boolean }) {
  return <button className={`ed-chip ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={on}>{children}</button>;
}

export function Editor({ initial }: { initial?: CustomSpec }) {
  const [spec, setSpec] = useState<CustomSpec>(() => initial ?? defaultCustomSpec());
  const [tool, setTool] = useState<PaintTool>('raise');
  const [saved, setSaved] = useState<SavedCustom[]>(() => loadSavedCustom());
  const [share, setShare] = useState<string | null>(null);
  const result = useMemo(() => buildCustomLevel(spec), [spec]);
  const level = result.level;
  const toast = (t: string, k: 'info' | 'success' | 'error' = 'info') => useUi.getState().toast(t, k);

  const upd = (f: (s: CustomSpec) => CustomSpec) => { setSpec((s) => f(structuredClone(s))); setShare(null); };
  const L = spec.layout;
  const toggleSide = (sd: Side) => upd((s) => {
    const on = s.layout.sides.includes(sd);
    if (on && s.layout.sides.length <= 2) return s;
    s.layout.sides = on ? s.layout.sides.filter((x) => x !== sd) : SIDES.filter((x) => x === sd || s.layout.sides.includes(x));
    s.layout.hubs = (s.layout.hubs ?? []).filter((h) => s.layout.sides.includes(h));
    if (!s.layout.hubs.length) s.layout.hubs = [s.layout.sides[0]!];
    return s;
  });
  const toggleIn = (key: 'hubs' | 'doubleBridge', sd: Side) => upd((s) => {
    const arr: Side[] = s.layout[key] ?? [];
    s.layout[key] = arr.includes(sd) ? arr.filter((x) => x !== sd) : [...arr, sd];
    if (key === 'hubs' && !s.layout.hubs!.length) s.layout.hubs = [sd];
    return s;
  });
  const toggleCorner = (c: Corner) => upd((s) => { const a = s.layout.corners ?? []; s.layout.corners = a.includes(c) ? a.filter((x) => x !== c) : [...a, c]; return s; });
  const toggleKind = (k: EnemyKind) => upd((s) => {
    const r = s.plan.roster;
    s.plan.roster = r.includes(k) ? (r.length > 1 ? r.filter((x) => x !== k) : r) : r.length < 12 ? [...r, k] : r;
    return s;
  });
  const paint = (x: number, z: number) => upd((s) => {
    const o = { ...(s.overrides ?? {}) };
    const k = `${x},${z}`;
    if (tool === 'reset' || o[k] === tool) delete o[k]; else o[k] = tool;
    s.overrides = o;
    return s;
  });

  const play = async () => {
    const r = registerCustom(spec);
    if (!r.ok) { toast('地圖還有問題，先修正紅字再試玩', 'error'); audio.play('illegal'); return; }
    await launchLevel(r.id, false);
  };
  const doSave = () => { setSaved(saveCustom(spec)); toast(`已儲存「${spec.name}」`, 'success'); audio.play('click'); };
  const doShare = async () => {
    if (!result.ok) { toast('地圖還有問題，無法分享', 'error'); return; }
    const url = `${location.origin}${location.pathname}?custom=${encodeCustom(spec)}`;
    setShare(url);
    try { await navigator.clipboard.writeText(url); toast('分享連結已複製', 'success'); } catch { toast('請手動複製下方的連結', 'info'); }
  };
  const portalCount = L.sides.reduce((n, s) => n + (L.portals?.[s] ?? 1), 0);

  return (
    <div className="editor-screen">
      <header className="editor-head panel">
        <button className="btn ghost" onClick={() => { audio.play('click'); useUi.getState().set({ screen: 'title' }); }}>← 返回</button>
        <h2>關卡編輯器</h2>
        <input className="ed-name" value={spec.name} maxLength={20} onChange={(e) => { const v = e.target.value; upd((s) => ({ ...s, name: v || '我的浮島' })); }} aria-label="關卡名稱" />
        <div className="editor-actions">
          <button className="btn" onClick={doSave}>儲存</button>
          <button className="btn" onClick={() => void doShare()}>分享連結</button>
          <button className="btn primary" onClick={() => void play()}>試玩</button>
        </div>
      </header>
      <div className="editor-body">
        <section className="editor-mapwrap panel">
          <div className="ed-tools" role="group" aria-label="地塊工具">
            {TOOLS.map(([t, l]) => <Chip key={t} on={tool === t} onClick={() => setTool(t)}>{l}</Chip>)}
            <button className="ed-chip" onClick={() => upd((s) => ({ ...s, overrides: {} }))}>清除修改</button>
          </div>
          <MapCanvas level={level} overrides={spec.overrides ?? {}} onPaint={paint} />
          <div className={`ed-status ${result.ok ? 'ok' : 'bad'}`}>
            {result.ok
              ? `✓ 可以遊玩・${portalCount} 個入口・${level!.connectors.length} 座橋・${spec.plan.waves} 波`
              : `✕ ${explain(result.errors).join('；')}${Object.keys(spec.overrides ?? {}).length ? '' : '・換一個種子試試（🎲 隨機只會挑可玩的種子）'}`}
          </div>
          {share && <input className="ed-share" readOnly value={share} onFocus={(e) => e.currentTarget.select()} aria-label="分享連結" />}
        </section>
        <section className="editor-form panel">
          <h3>島嶼</h3>
          <Row label="種子"><input type="number" className="ed-num" value={spec.seed} min={1} max={999999} onChange={(e) => { const v = Math.max(1, Math.min(999999, Math.floor(Number(e.target.value) || 1))); upd((s) => ({ ...s, seed: v, overrides: {} })); }} /><button className="ed-chip" onClick={() => upd((s) => ({ ...s, seed: findValidSeed(s, 1 + Math.floor(Math.random() * 999998)), overrides: {} }))}>🎲 隨機</button></Row>
          <Row label="主題"><Seg value={spec.theme} options={THEMES} onChange={(v) => upd((s) => ({ ...s, theme: v }))} /></Row>
          <Row label="天氣"><Seg value={spec.weather} options={WEATHERS} onChange={(v) => upd((s) => ({ ...s, weather: v }))} /></Row>
          <Row label="外島">{SIDES.map((sd) => <Chip key={sd} on={L.sides.includes(sd)} onClick={() => toggleSide(sd)}>{SIDE_NAME[sd]}</Chip>)}</Row>
          <Row label="直通中央">{L.sides.map((sd) => <Chip key={sd} on={(L.hubs ?? []).includes(sd)} onClick={() => toggleIn('hubs', sd)}>{SIDE_NAME[sd]}</Chip>)}</Row>
          <Row label="雙橋">{L.sides.filter((sd) => (L.hubs ?? L.sides).includes(sd)).map((sd) => <Chip key={sd} on={(L.doubleBridge ?? []).includes(sd)} onClick={() => toggleIn('doubleBridge', sd)}>{SIDE_NAME[sd]}</Chip>)}</Row>
          <Row label="轉角橋">{CORNERS.map((c) => <Chip key={c} disabled={!L.sides.includes(c[0] as Side) || !L.sides.includes(c[1] as Side)} on={(L.corners ?? []).includes(c)} onClick={() => toggleCorner(c)}>{CORNER_NAME[c]}</Chip>)}</Row>
          <Row label="雙入口">{L.sides.map((sd) => <Chip key={sd} on={(L.portals?.[sd] ?? 1) === 2} onClick={() => upd((s) => { const p = { ...(s.layout.portals ?? {}) }; if (p[sd] === 2) delete p[sd]; else p[sd] = 2; s.layout.portals = p; return s; })}>{SIDE_NAME[sd]}</Chip>)}</Row>
          <Row label="中央高度"><Seg value={L.coreElevation} options={[[1, '1'], [2, '2'], [3, '3'], [4, '4']] as const} onChange={(v) => upd((s) => { s.layout.coreElevation = v; return s; })} /></Row>
          <Row label="石柱"><input type="range" min={0} max={8} value={L.pillars} onChange={(e) => { const v = Number(e.target.value); upd((s) => { s.layout.pillars = v; return s; }); }} /><em>{L.pillars}</em></Row>
          <h3>敵人與難度</h3>
          <Row label="怪物">
            <div className="ed-kinds">
              {NORMAL_KINDS.map((k) => <Chip key={k} on={spec.plan.roster.includes(k)} onClick={() => toggleKind(k)}><EnemyIcon kind={k} size={18} />{ENEMY_DEFS[k].name}</Chip>)}
            </div>
          </Row>
          <Row label="頭目">{BOSS_KINDS.map((k) => <Chip key={k} on={spec.plan.finalBoss === k} onClick={() => upd((s) => { s.plan.finalBoss = k; return s; })}><EnemyIcon kind={k} size={18} />{ENEMY_DEFS[k].name}</Chip>)}</Row>
          <Row label="波數"><input type="range" min={3} max={12} value={spec.plan.waves} onChange={(e) => { const v = Number(e.target.value); upd((s) => { s.plan.waves = v; return s; }); }} /><em>{spec.plan.waves}</em></Row>
          <Row label="怪物數量"><input type="range" min={0.3} max={2} step={0.05} value={spec.plan.density} onChange={(e) => { const v = Number(e.target.value); upd((s) => { s.plan.density = v; return s; }); }} /><em>{Math.round(spec.plan.density * 100)}%</em></Row>
          <Row label="怪物生命"><input type="range" min={0.3} max={3} step={0.05} value={spec.plan.hp[1]} onChange={(e) => { const v = Number(e.target.value); upd((s) => { s.plan.hp = [Math.round(v * 0.46 * 100) / 100, v]; return s; }); }} /><em>×{spec.plan.hp[1].toFixed(2)}</em></Row>
          <Row label="起始金幣"><input type="range" min={100} max={1500} step={10} value={spec.initialGold} onChange={(e) => { const v = Number(e.target.value); upd((s) => ({ ...s, initialGold: v })); }} /><em>{spec.initialGold}</em></Row>
          <Row label="核心生命"><input type="range" min={1} max={40} value={spec.coreHp} onChange={(e) => { const v = Number(e.target.value); upd((s) => ({ ...s, coreHp: v })); }} /><em>{spec.coreHp}</em></Row>
          {saved.length > 0 && (
            <>
              <h3>我的關卡</h3>
              <ul className="ed-saved">
                {saved.map((s) => (
                  <li key={s.id}>
                    <span>{s.spec.name}</span>
                    <button className="ed-chip" onClick={() => { setSpec(structuredClone(s.spec)); setShare(null); }}>開啟</button>
                    <button className="ed-chip" onClick={() => setSaved(deleteCustom(s.id))} aria-label={`刪除 ${s.spec.name}`}>刪除</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
