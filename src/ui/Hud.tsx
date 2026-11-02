import { useEffect, useState, type ReactElement } from 'react';
import type { EnemyKind, TowerKind } from '../domain/types';
import {
  ECONOMY, ENEMY_DEFS, HIGH_GROUND_PER_LEVEL, LEVEL_DAMAGE_MULT, LEVEL_RANGE_BONUS, TOWER_DEFS, sellRefund, upgradeCost,
} from '../domain/definitions';
import { controller, level, runtime, syncStore } from '../app/runtime';
import { useUi } from '../state/store';
import { saveSettings, type SettingsV1 } from '../settings/settings';
import { audio } from '../audio/audio';
import { issue, setTool, startWave } from './GameView';
import {
  CoinIcon, EnemyIcon, GearIcon, HeartIcon, LowerIcon, PauseIcon, PlayIcon, RaiseIcon, RotateIcon, StarIcon, TowerIcon, UndoIcon, WallIcon,
} from './icons';

const TOWER_ORDER: TowerKind[] = ['arrow', 'frost', 'cannon'];
const TOWER_BLURB: Record<TowerKind, string> = {
  arrow: '單體物理傷害，射速快。高地加射程。',
  frost: '魔法傷害並緩速 30%。適合放在轉角。',
  cannon: '範圍爆炸，對付成群敵人。巨人也怕砲擊。',
};
const ENEMY_NAMES: Record<EnemyKind, string> = { slime: ENEMY_DEFS.slime.name, runner: ENEMY_DEFS.runner.name, golem: ENEMY_DEFS.golem.name };

function openMenu() {
  const u = useUi.getState();
  u.set({ pauseOpen: true });
  if (u.phase === 'COMBAT') { controller.flags.paused = true; syncStore(); }
  audio.play('click');
}

function cancelTool() {
  useUi.getState().set({ tool: { type: 'none' }, preview: null });
  runtime.scene?.setPreview(null);
}

function clearSelection() {
  useUi.getState().set({ selection: null });
  runtime.scene?.setSelection(null);
}

/* ------------------------------------------------------------------ top bar */
function TopLeft() {
  const waveIndex = useUi((s) => s.waveIndex);
  const waveCount = useUi((s) => s.waveCount);
  const hp = useUi((s) => s.coreHp);
  const maxHp = useUi((s) => s.maxHp);
  const pulse = useUi((s) => s.heartPulse);
  const phase = useUi((s) => s.phase);
  const shownWave = Math.min(waveCount, waveIndex + 1);
  const pct = Math.max(0, hp / maxHp);
  return (
    <div className="panel hud-topleft">
      <div className="hud-level">
        <span className="hud-level-tag">L1-01</span>
        <span className="hud-level-name">{level.name}</span>
      </div>
      <div className="hud-row">
        <div className="hud-wave">
          <span className="hud-label">波次</span>
          <span className="hud-wave-num">{shownWave}<small>/{waveCount}</small></span>
          <div className="wave-pips">
            {Array.from({ length: waveCount }, (_, i) => (
              <i key={i} className={i < waveIndex || (i === waveIndex && phase === 'WAVE_RESULT') ? 'done' : i === waveIndex ? 'cur' : ''} />
            ))}
          </div>
        </div>
        <div key={pulse} className={`hud-heart ${pulse ? 'pulse' : ''} ${pct <= 0.25 ? 'danger' : ''}`}>
          <HeartIcon size={26} />
          <div className="hud-hp">
            <span>{hp}<small>/{maxHp}</small></span>
            <div className="hp-bar"><i style={{ width: `${pct * 100}%` }} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopRight() {
  const gold = useUi((s) => s.gold);
  const preview = useUi((s) => s.preview);
  const coinPulse = useUi((s) => s.coinPulse);
  const phase = useUi((s) => s.phase);
  const paused = useUi((s) => s.paused);
  const speed = useUi((s) => s.speed);
  const delta = preview?.ok && preview.cost ? -preview.cost : 0;
  return (
    <div className="hud-topright">
      <div key={coinPulse} className={`panel hud-gold ${coinPulse ? 'pulse' : ''}`}>
        <CoinIcon size={26} />
        <span className="hud-gold-num">{gold}</span>
        {delta !== 0 && <span className={`hud-gold-delta ${gold + delta < 0 ? 'bad' : ''}`}>{delta > 0 ? '+' : ''}{delta}</span>}
      </div>
      {phase === 'COMBAT' && (
        <div className="panel hud-speed">
          <button className="icon-btn" title="暫停 (Space)" onClick={() => { controller.flags.paused = !controller.flags.paused; syncStore(); audio.play('click'); }}>
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button className={`icon-btn speed ${speed === 2 ? 'on' : ''}`} title="倍速" onClick={() => { controller.flags.speed = speed === 1 ? 2 : 1; syncStore(); audio.play('click'); }}>
            {speed}×
          </button>
        </div>
      )}
      <div className="panel hud-cam">
        <button className="icon-btn" title="向左旋轉 (Q)" aria-label="向左旋轉" onClick={() => runtime.scene?.rig.rotate(-1)}><RotateIcon dir={-1} /></button>
        <button className="icon-btn" title="向右旋轉 (E)" aria-label="向右旋轉" onClick={() => runtime.scene?.rig.rotate(1)}><RotateIcon dir={1} /></button>
        <button className="icon-btn" title="選單 (Esc)" aria-label="選單" onClick={openMenu}><GearIcon /></button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ toolbar */
function ToolButton(props: {
  active: boolean; disabled: boolean; hotkey: string; cost: number | string; label: string; icon: ReactElement; onClick(): void; tip?: string; affordable?: boolean;
}) {
  return (
    <button
      className={`tool-btn ${props.active ? 'active' : ''} ${props.affordable === false ? 'poor' : ''}`}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.tip}
    >
      <span className="tool-key">{props.hotkey}</span>
      <span className="tool-icon">{props.icon}</span>
      <span className="tool-label">{props.label}</span>
      <span className="tool-cost"><CoinIcon size={13} />{props.cost}</span>
    </button>
  );
}

function Toolbar() {
  const tool = useUi((s) => s.tool);
  const gold = useUi((s) => s.gold);
  const phase = useUi((s) => s.phase);
  const canUndo = useUi((s) => s.canUndo);
  const prep = phase === 'PREPARE';
  const touch = useUi((s) => s.touchUi);
  const [hoverKind, setHoverKind] = useState<TowerKind | null>(null);
  return (
    <div className={`hud-toolbar ${prep ? '' : 'locked'}`}>
      {hoverKind && !touch && (
        <div className="panel tower-tip">
          <div className="tower-tip-title">{TOWER_DEFS[hoverKind].name}</div>
          <div className="tower-tip-stats">
            <span>傷害 {TOWER_DEFS[hoverKind].baseDamage}</span>
            <span>射程 {TOWER_DEFS[hoverKind].baseRangeWorld}</span>
            <span>{TOWER_DEFS[hoverKind].damageType === 'magic' ? '魔法' : '物理'}</span>
          </div>
          <div className="tower-tip-text">{TOWER_BLURB[hoverKind]}</div>
        </div>
      )}
      <div className="panel toolbar-group towers">
        {TOWER_ORDER.map((k, i) => (
          <div key={k} onMouseEnter={() => setHoverKind(k)} onMouseLeave={() => setHoverKind(null)}>
            <ToolButton
              active={tool.type === 'build' && tool.kind === k}
              disabled={!prep}
              affordable={gold >= TOWER_DEFS[k].buildCost}
              hotkey={String(i + 1)}
              cost={TOWER_DEFS[k].buildCost}
              label={TOWER_DEFS[k].name}
              icon={<TowerIcon kind={k} size={40} />}
              onClick={() => setTool({ type: 'build', kind: k })}
            />
          </div>
        ))}
      </div>
      <div className="panel toolbar-group terrain">
        <ToolButton active={tool.type === 'raise'} disabled={!prep} affordable={gold >= ECONOMY.raiseCost} hotkey="R" cost={ECONOMY.raiseCost} label="抬升" icon={<RaiseIcon />} onClick={() => setTool({ type: 'raise' })} tip="抬升地形一格：高地塔射程更遠" />
        <ToolButton active={tool.type === 'lower'} disabled={!prep} affordable={gold >= ECONOMY.lowerCost} hotkey="F" cost={ECONOMY.lowerCost} label="降低" icon={<LowerIcon />} onClick={() => setTool({ type: 'lower' })} tip="降低地形一格" />
        <ToolButton active={tool.type === 'wall'} disabled={!prep} affordable={gold >= ECONOMY.wallCost} hotkey="B" cost={ECONOMY.wallCost} label="木牆" icon={<WallIcon />} onClick={() => setTool({ type: 'wall' })} tip="擋路改變敵人路線，不可完全封死" />
      </div>
      <div className="panel toolbar-group small">
        <button className="tool-btn undo" disabled={!prep || !canUndo} onClick={() => issue({ type: 'UNDO_PREPARE' })} title="復原 (Ctrl+Z)">
          <span className="tool-icon"><UndoIcon /></span>
          <span className="tool-label">復原</span>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ selection */
function SelectionPanel() {
  const sel = useUi((s) => s.selection);
  const phase = useUi((s) => s.phase);
  useUi((s) => s.gold); // re-render on gold change for affordability
  if (!sel) return null;
  const prep = phase === 'PREPARE';
  if (sel.type === 'tower') {
    const t = controller.state.towers.find((x) => x.id === sel.id);
    if (!t) return null;
    const def = TOWER_DEFS[t.kind];
    const elev = controller.elevationOf(t.anchorCellId);
    const range = def.baseRangeWorld + LEVEL_RANGE_BONUS[t.level] + HIGH_GROUND_PER_LEVEL * elev;
    const dmg = Math.round(def.baseDamage * LEVEL_DAMAGE_MULT[t.level]);
    const nextLevel = t.level < 3 ? ((t.level + 1) as 2 | 3) : null;
    const upCost = nextLevel ? upgradeCost(t.kind, nextLevel) : 0;
    const cells = controller.rangeForTower(t.id);
    const blocked = cells.filter((c) => c.state === 'occluded').length;
    const stats = controller.waveStats.towers[t.id];
    return (
      <div className="panel selection-panel">
        <div className="sel-head">
          <TowerIcon kind={t.kind} size={44} />
          <div>
            <div className="sel-title">{def.name}</div>
            <div className="sel-level">{'★'.repeat(t.level)}<span>{'★'.repeat(3 - t.level)}</span> Lv.{t.level}</div>
          </div>
          <button className="close-btn" onClick={clearSelection} aria-label="關閉">×</button>
        </div>
        <div className="sel-stats">
          <div><label>傷害</label><b>{dmg}</b></div>
          <div><label>射程</label><b>{range.toFixed(1)}</b></div>
          <div><label>高度</label><b>{elev}</b></div>
          {stats && <div><label>本波擊殺</label><b>{stats.kills}</b></div>}
        </div>
        {elev > 1 && <div className="sel-note good">▲ 高地加成 +{(HIGH_GROUND_PER_LEVEL * elev).toFixed(1)} 射程</div>}
        {blocked > 0 && <div className="sel-note warn">◐ {blocked} 格被地形擋住視線（顯示為斜線）</div>}
        {prep && (
          <div className="sel-actions">
            {nextLevel ? (
              <button className="btn primary" disabled={controller.state.gold < upCost} onClick={() => issue({ type: 'UPGRADE_TOWER', towerId: t.id })}>
                升級 <span className="btn-cost"><CoinIcon size={14} />{upCost}</span>
              </button>
            ) : <button className="btn" disabled>已滿級</button>}
            <button className="btn danger" onClick={() => { issue({ type: 'SELL_TOWER', towerId: t.id }); clearSelection(); }}>
              出售 <span className="btn-cost">+{sellRefund(t.investedGold)}</span>
            </button>
          </div>
        )}
      </div>
    );
  }
  if (sel.type === 'wall') {
    return (
      <div className="panel selection-panel">
        <div className="sel-head">
          <WallIcon />
          <div><div className="sel-title">木牆</div><div className="sel-sub">阻擋敵人行走</div></div>
          <button className="close-btn" onClick={clearSelection} aria-label="關閉">×</button>
        </div>
        {prep && (
          <div className="sel-actions">
            <button className="btn danger" onClick={() => { issue({ type: 'REMOVE_WALL', wallId: sel.id }); clearSelection(); }}>
              拆除 <span className="btn-cost">+{ECONOMY.wallRefund}</span>
            </button>
          </div>
        )}
      </div>
    );
  }
  const c = level.cells.find((x) => x.id === sel.cellId);
  if (!c) return null;
  const conn = level.connectors.find((x) => x.chain.includes(c.id));
  const plat = level.platforms.find((p) => p.id === c.platformId);
  return (
    <div className="panel selection-panel compact">
      <div className="sel-head">
        <div>
          <div className="sel-title">{conn?.name ?? plat?.name ?? '地塊'}</div>
          <div className="sel-sub">高度 {controller.elevationOf(c.id)} · {c.editable ? '可改造地形' : '不可改造'} · {c.buildable ? '可建塔' : '不可建塔'}</div>
        </div>
        <button className="close-btn" onClick={clearSelection} aria-label="關閉">×</button>
      </div>
      {conn && <div className="sel-note">此橋連接兩座浮島，是敵人跨島的唯一通道。橋與橋口不可改造。</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ hover tooltip / tool hint */
function ToolHint() {
  const tool = useUi((s) => s.tool);
  const preview = useUi((s) => s.preview);
  const hover = useUi((s) => s.hover);
  const touch = useUi((s) => s.touchUi);
  if (tool.type === 'none') {
    if (!hover) return null;
    return (
      <div className="hover-chip">
        <b>{hover.platform}</b> · 高度 {hover.elevation}{hover.editable ? '' : ' · 不可改造'}
      </div>
    );
  }
  const label = tool.type === 'build' ? TOWER_DEFS[tool.kind].name : tool.type === 'raise' ? '抬升地形' : tool.type === 'lower' ? '降低地形' : '放置木牆';
  return (
    <div className={`hover-chip tool ${preview ? (preview.ok ? 'ok' : 'bad') : ''}`}>
      <b>{label}</b>
      {preview ? (preview.ok ? <> · 花費 {preview.cost}{hover ? ` · 高度 ${hover.elevation}` : ''}</> : <> · {preview.message}</>) : <> · {touch ? '點選地塊預覽' : '選擇地塊'}</>}
      {touch
        ? <>
            {preview?.ok && <span className="chip-confirm">再點一次同一格確認</span>}
            <button className="chip-cancel" onClick={cancelTool} aria-label="取消">取消</button>
          </>
        : <span className="chip-esc">右鍵/Esc 取消</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ start wave */
function StartWave() {
  const phase = useUi((s) => s.phase);
  const waveIndex = useUi((s) => s.waveIndex);
  const preview = useUi((s) => s.wavePreview);
  const intro = useUi((s) => s.introPlaying);
  if (phase !== 'PREPARE' || intro) return null;
  const totals: Partial<Record<EnemyKind, number>> = {};
  for (const p of Object.values(preview)) for (const [k, n] of Object.entries(p)) totals[k as EnemyKind] = (totals[k as EnemyKind] ?? 0) + n;
  return (
    <div className="start-wave">
      <div className="panel start-wave-preview">
        <div className="swp-title">第 {waveIndex + 1} 波來襲</div>
        <div className="swp-enemies">
          {Object.entries(totals).map(([k, n]) => (
            <span key={k} title={ENEMY_NAMES[k as EnemyKind]}><EnemyIcon kind={k as EnemyKind} size={22} />×{n}</span>
          ))}
        </div>
      </div>
      <button className="btn start" onClick={startWave}>
        <PlayIcon /> 開始波次 <kbd>Enter</kbd>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ tutorial */
const TUTORIAL = [
  '敵人會沿著發光路線走向守護之心。按 1 選擇箭塔，放在路線旁。',
  '在路線轉角附近建塔，能打到更多敵人。',
  '試試抬升地形（R）：高地塔射程更遠。斜線格代表視線被擋住。',
  '準備好了就按「開始波次」。',
];
const TUTORIAL_TOUCH = [
  '敵人會沿著發光路線走向守護之心。點下方的箭塔，再點路線旁的地塊。',
  '先點一下會預覽位置與花費，再點同一格就會建造。轉角附近能打到更多敵人。',
  '試試「抬升」地形：高地塔射程更遠。單指拖曳平移、雙指縮放或旋轉視角。',
  '準備好了就按「開始波次」。',
];
function Tutorial() {
  const step = useUi((s) => s.tutorialStep);
  const phase = useUi((s) => s.phase);
  const waveIndex = useUi((s) => s.waveIndex);
  const intro = useUi((s) => s.introPlaying);
  const tool = useUi((s) => s.tool);
  const touch = useUi((s) => s.touchUi);
  const lines = touch ? TUTORIAL_TOUCH : TUTORIAL;
  useEffect(() => {
    if (step === 0 && tool.type === 'build') useUi.getState().set({ tutorialStep: 1 });
  }, [step, tool]);
  if (intro || phase !== 'PREPARE' || waveIndex > 0 || step >= TUTORIAL.length) return null;
  return (
    <div className="panel tutorial">
      <span className="tutorial-step">{step + 1}/{TUTORIAL.length}</span>
      <span>{lines[step]}</span>
      <button className="link-btn" onClick={() => useUi.getState().set({ tutorialStep: step + 1 })}>{step + 1 < TUTORIAL.length ? '下一則' : '知道了'}</button>
    </div>
  );
}

/* ------------------------------------------------------------------ toasts */
function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

/* ------------------------------------------------------------------ result panels */
function TowerStatsTable() {
  const stats = useUi((s) => s.lastWaveStats);
  if (!stats) return null;
  const rows = controller.state.towers.map((t) => ({ t, s: stats.towers[t.id] ?? { damage: 0, kills: 0 } }));
  const maxDmg = Math.max(1, ...rows.map((r) => r.s.damage));
  if (rows.length === 0) return <div className="muted">沒有建造任何塔。</div>;
  return (
    <div className="stats-table">
      {rows.sort((a, b) => b.s.damage - a.s.damage).slice(0, 8).map(({ t, s }) => (
        <div key={t.id} className="stats-row">
          <TowerIcon kind={t.kind} size={26} />
          <span className="stats-name">{TOWER_DEFS[t.kind].name} Lv.{t.level}</span>
          <div className="stats-bar"><i style={{ width: `${(s.damage / maxDmg) * 100}%` }} /></div>
          <span className="stats-num">{Math.round(s.damage)}</span>
          <span className="stats-kills">{s.kills} 擊殺</span>
        </div>
      ))}
    </div>
  );
}

function WaveResult() {
  const phase = useUi((s) => s.phase);
  const stats = useUi((s) => s.lastWaveStats);
  const waveIndex = useUi((s) => s.waveIndex);
  if (phase !== 'WAVE_RESULT' || !stats) return null;
  const leaks = Object.values(stats.leaksByPortal).reduce((a, b) => a + b, 0);
  return (
    <div className="modal-wrap soft">
      <div className="panel modal result">
        <div className="ribbon">第 {stats.waveIndex + 1} 波 守住了！</div>
        <div className="result-kpis">
          <div><label>擊敗</label><b>{stats.kills}</b></div>
          <div><label>獲得金幣</label><b className="gold">+{stats.goldEarned}</b></div>
          <div><label>漏怪</label><b className={leaks ? 'bad' : 'good'}>{leaks}</b></div>
        </div>
        <TowerStatsTable />
        <button className="btn primary big" onClick={() => issue({ type: 'CONTINUE' })} autoFocus>
          準備第 {waveIndex + 2} 波 <kbd>Enter</kbd>
        </button>
      </div>
    </div>
  );
}

function Defeat() {
  const phase = useUi((s) => s.phase);
  const text = useUi((s) => s.failureText);
  const hasCp = useUi((s) => s.hasCheckpoint);
  if (phase !== 'DEFEAT') return null;
  return (
    <div className="modal-wrap dark">
      <div className="panel modal defeat">
        <div className="ribbon red">守護之心碎裂了</div>
        <div className="failure-box">
          <div className="failure-label">失敗分析</div>
          <div className="failure-text">{text ?? '敵人突破了防線。'}</div>
        </div>
        <TowerStatsTable />
        <div className="modal-actions">
          <button className="btn primary big" disabled={!hasCp} onClick={async () => { await controller.restartFromCheckpoint(); syncStore(); useUi.getState().set({ failureText: null }); }}>
            從本波準備期重來
          </button>
          <button className="btn" onClick={() => { controller.newGame(); syncStore(); }}>重新開始關卡</button>
          <button className="btn ghost" onClick={() => useUi.getState().set({ screen: 'title' })}>回到標題</button>
        </div>
      </div>
    </div>
  );
}

function Victory() {
  const phase = useUi((s) => s.phase);
  const stars = useUi((s) => s.stars);
  const hp = useUi((s) => s.coreHp);
  if (phase !== 'VICTORY') return null;
  return (
    <div className="modal-wrap soft">
      <div className="panel modal victory">
        <div className="ribbon gold">天空島守住了！</div>
        <div className="stars">
          {[1, 2, 3].map((i) => <span key={i} className={`star s${i}`} style={{ animationDelay: `${0.3 + i * 0.25}s` }}><StarIcon filled={stars >= i} size={64} /></span>)}
        </div>
        <div className="victory-sub">守護之心剩餘 {hp} 生命</div>
        <TowerStatsTable />
        <div className="modal-actions">
          <button className="btn primary big" onClick={() => { controller.newGame(); syncStore(); }}>再玩一次</button>
          <button className="btn ghost" onClick={() => useUi.getState().set({ screen: 'title' })}>回到標題</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pause / settings */
function PauseMenu() {
  const open = useUi((s) => s.pauseOpen);
  const phase = useUi((s) => s.phase);
  if (!open) return null;
  const close = () => { useUi.getState().set({ pauseOpen: false }); controller.flags.paused = false; syncStore(); };
  return (
    <div className="modal-wrap dark" onClick={close}>
      <div className="panel modal pause" onClick={(e) => e.stopPropagation()}>
        <div className="ribbon">{phase === 'COMBAT' ? '暫停' : '選單'}</div>
        <div className="modal-actions column">
          <button className="btn primary big" onClick={close}>繼續遊戲</button>
          <button className="btn" onClick={() => useUi.getState().set({ settingsOpen: true })}>設定</button>
          <button className="btn" onClick={() => useUi.getState().set({ helpOpen: true })}>操作說明</button>
          <button className="btn ghost" onClick={() => { close(); useUi.getState().set({ screen: 'title' }); }}>回到標題（自動存檔）</button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <label className="set-row">
      <span>{label}</span>
      <button className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)} role="switch" aria-checked={value}><i /></button>
    </label>
  );
}
function Slider({ value, onChange, label, min = 0, max = 1, step = 0.05 }: { value: number; onChange(v: number): void; label: string; min?: number; max?: number; step?: number }) {
  return (
    <label className="set-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <em>{Math.round(value * 100)}%</em>
    </label>
  );
}

export function SettingsPanel() {
  const open = useUi((s) => s.settingsOpen);
  const s = useUi((st) => st.settings);
  const qualityLabel = useUi((st) => st.qualityLabel);
  if (!open) return null;
  const update = (p: Partial<SettingsV1>) => {
    const next = { ...s, ...p };
    useUi.getState().set({ settings: next });
    saveSettings(next);
  };
  const vol = (k: keyof SettingsV1['volume'], v: number) => update({ volume: { ...s.volume, [k]: v } });
  const qualities: SettingsV1['quality'][] = ['auto', 'low', 'medium', 'high', 'ultra'];
  const qName: Record<string, string> = { auto: '自動', low: '低', medium: '中', high: '高', ultra: '極致' };
  return (
    <div className="modal-wrap dark" onClick={() => useUi.getState().set({ settingsOpen: false })}>
      <div className="panel modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="ribbon">設定</div>
        <button className="close-btn corner" onClick={() => useUi.getState().set({ settingsOpen: false })} aria-label="關閉">×</button>
        <div className="settings-grid">
          <section>
            <h3>畫面</h3>
            <div className="set-row">
              <span>畫質</span>
              <div className="seg">
                {qualities.map((q) => <button key={q} className={s.quality === q ? 'on' : ''} onClick={() => update({ quality: q })}>{qName[q]}</button>)}
              </div>
            </div>
            <div className="set-hint">目前：{qName[qualityLabel] ?? qualityLabel}</div>
            <Toggle label="動態解析度" value={s.dynamicResolution} onChange={(v) => update({ dynamicResolution: v })} />
            <Toggle label="傷害數字" value={s.damageNumbers} onChange={(v) => update({ damageNumbers: v })} />
            <Toggle label="滑鼠移到邊緣捲動地圖" value={s.edgeScroll} onChange={(v) => update({ edgeScroll: v })} />
            <Slider label="UI 大小" value={s.uiScale} min={0.8} max={1.3} onChange={(v) => update({ uiScale: v })} />
          </section>
          <section>
            <h3>無障礙</h3>
            <Toggle label="色盲友善配色" value={s.colorblindSafe} onChange={(v) => update({ colorblindSafe: v })} />
            <Toggle label="減少動態" value={s.reducedMotion} onChange={(v) => update({ reducedMotion: v })} />
            <Slider label="畫面震動" value={s.screenShake} onChange={(v) => update({ screenShake: v })} />
          </section>
          <section>
            <h3>音量</h3>
            <Slider label="主音量" value={s.volume.master} onChange={(v) => vol('master', v)} />
            <Slider label="音樂" value={s.volume.music} onChange={(v) => vol('music', v)} />
            <Slider label="音效" value={s.volume.sfx} onChange={(v) => vol('sfx', v)} />
            <Slider label="介面" value={s.volume.ui} onChange={(v) => vol('ui', v)} />
            <Slider label="環境" value={s.volume.ambience} onChange={(v) => vol('ambience', v)} />
          </section>
        </div>
      </div>
    </div>
  );
}

export function HelpPanel() {
  const open = useUi((s) => s.helpOpen);
  const touch = useUi((s) => s.touchUi);
  if (!open) return null;
  const touchRows: [string, string][] = [
    ['點工具', '選擇塔 / 抬升 / 降低 / 木牆（再點一次取消）'], ['點地塊', '預覽位置與花費'], ['再點同一格', '確認建造 / 改造'],
    ['點塔或牆', '選取，可升級 / 出售 / 拆除'], ['單指拖曳', '平移視角'], ['雙指捏合', '縮放'], ['雙指旋轉', '旋轉視角 90°'],
    ['⟲ ⟳ 按鈕', '旋轉視角'], ['⚙ 按鈕', '選單 / 設定'],
  ];
  const rows: [string, string][] = touch ? touchRows : [
    ['1 / 2 / 3', '選擇箭塔 / 冰晶塔 / 火砲塔'], ['R / F', '抬升 / 降低地形'], ['B', '放置木牆'], ['Ctrl+Z', '復原（準備期，最多 20 步）'],
    ['左鍵', '放置 / 選取'], ['右鍵 / Esc', '取消'], ['U / X', '升級 / 出售選取的塔'], ['Tab（按住）', '顯示所有塔射程'],
    ['Q / E', '旋轉視角'], ['滾輪 / + -', '縮放'], ['WASD / 中鍵拖曳', '平移'], ['Enter', '開始波次 / 繼續'], ['Space', '暫停'],
    ['觸控', '單指拖曳平移、雙指縮放 / 旋轉、點兩下確認放置'],
  ];
  return (
    <div className="modal-wrap dark" onClick={() => useUi.getState().set({ helpOpen: false })}>
      <div className="panel modal help" onClick={(e) => e.stopPropagation()}>
        <div className="ribbon">操作說明</div>
        <div className="help-grid">{rows.map(([k, v]) => <div key={k} className="help-row"><kbd>{k}</kbd><span>{v}</span></div>)}</div>
        <div className="help-enemies">
          {(Object.keys(ENEMY_DEFS) as EnemyKind[]).map((k) => (
            <div key={k} className="help-enemy"><EnemyIcon kind={k} size={26} /><b>{ENEMY_NAMES[k]}</b><span>生命 {ENEMY_DEFS[k].hp} · 速度 {ENEMY_DEFS[k].speedCellsPerSecond}{ENEMY_DEFS[k].physicalResistance ? ` · 物抗 ${ENEMY_DEFS[k].physicalResistance * 100}%` : ''}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PerfHud() {
  const perf = useUi((s) => s.perf);
  const q = useUi((s) => s.qualityLabel);
  if (!perf) return null;
  return <div className="perf-hud">{perf.fps.toFixed(0)} fps · {perf.ms.toFixed(1)} ms · {perf.calls} calls · {(perf.tris / 1000).toFixed(0)}k tris · dpr {perf.dpr.toFixed(2)} · {q}</div>;
}

function CombatBanner() {
  const phase = useUi((s) => s.phase);
  const paused = useUi((s) => s.paused);
  const pauseOpen = useUi((s) => s.pauseOpen);
  const touch = useUi((s) => s.touchUi);
  if (phase !== 'COMBAT' || !paused || pauseOpen) return null;
  return <div className="paused-banner">已暫停 · {touch ? '點 ▶ 繼續' : '按 Space 繼續'}</div>;
}

export function Hud() {
  const intro = useUi((s) => s.introPlaying);
  const scale = useUi((s) => s.settings.uiScale);
  const touch = useUi((s) => s.touchUi);
  return (
    <div className={`hud ${intro ? 'intro' : ''} ${touch ? 'touch' : ''}`} style={{ ['--ui-scale' as string]: scale }}>
      <TopLeft />
      <TopRight />
      <Tutorial />
      <ToolHint />
      <SelectionPanel />
      <StartWave />
      <Toolbar />
      <Toasts />
      <CombatBanner />
      <WaveResult />
      <Defeat />
      <Victory />
      <PauseMenu />
      <SettingsPanel />
      <HelpPanel />
      <PerfHud />
      {intro && <div className="intro-skip">{touch ? '點一下畫面跳過' : '點擊或按任意鍵跳過'}</div>}
    </div>
  );
}
