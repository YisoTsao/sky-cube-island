import { useEffect, useState, type ReactElement } from 'react';
import type { EnemyKind, TargetingMode, TowerBranch, TowerKind, TowerLevel } from '../domain/types';
import { TOWER_BRANCHES } from '../domain/types';
import { TARGETING_MODES, TOWER_KINDS } from '../domain/types';
import {
  BRANCH_DEFS, ECONOMY, ENEMY_DEFS, TRAP_DEF, HIGH_GROUND_PER_LEVEL, MAX_TOWER_LEVEL, levelRangeBonus, TOWER_DEFS, highGroundBonus, nextTowerLevel, sellRefund, towerStats, upgradeCost,
} from '../domain/definitions';
import { controller, level, runtime, syncStore } from '../app/runtime';
import { executeCommand } from '../commands/execute';
import { useUi } from '../state/store';
import { saveSettings, type SettingsV1 } from '../settings/settings';
import { audio } from '../audio/audio';
import { issue, setTool, startWave } from './GameView';
import { launchLevel } from './launch';
import { TowerMenu, sellTower, startTowerMove } from './TowerMenu';
import { PhotoPanel, enterPhoto } from './PhotoMode';
import { challengeMet, challengesFor } from '../domain/challenges';
import { getLevel, nextLevelId } from '../levels/registry';
import {
  CameraIcon, CoinIcon, EnemyIcon, GearIcon, HeartIcon, LowerIcon, PauseIcon, PlayIcon, RaiseIcon, RotateIcon, StarIcon, TowerIcon, UndoIcon, WallIcon, TrapIcon, BridgeIcon,
} from './icons';

const TOWER_ORDER: readonly TowerKind[] = TOWER_KINDS;
export const TARGETING_LABEL: Record<TargetingMode, string> = { FIRST: '最前', LAST: '最後', STRONGEST: '最強', CLOSEST: '最近' };
const TARGETING_TIP: Record<TargetingMode, string> = {
  FIRST: '攻擊最接近核心的敵人',
  LAST: '攻擊最後面的敵人（適合和緩速塔搭配）',
  STRONGEST: '攻擊目前血量最高的敵人（適合對付頭目）',
  CLOSEST: '攻擊離塔最近的敵人',
};
const TOWER_BLURB: Record<TowerKind, string> = {
  arrow: '單體物理傷害，射速快。蓋在高處打低處的敵人可加射程。',
  frost: '魔法傷害並緩速 30%（升級後最高 45%），無視鐵甲甲蟲的物抗。適合放在轉角。',
  cannon: '範圍爆炸，對付成群敵人。巨人也怕砲擊。',
  lightning: '魔法閃電會連鎖跳到附近的敵人（每跳傷害 ×0.75），專剋成群小怪。',
  wind: '一次吹中多隻敵人並往回推，拖長牠們待在射程內的時間。頭目幾乎推不動。',
};

function towerSpecial(kind: TowerKind, lv: TowerLevel = 1, branch?: TowerBranch): string | null {
  if (lv >= 4) return BRANCH_DEFS[kind][branch ?? 'A'].blurb;
  const st = towerStats(kind, lv);
  if (st.chainJumps !== undefined) return `連鎖 ${st.chainJumps} 次`;
  if (st.knockbackCells !== undefined) return `推退 ${st.knockbackCells.toFixed(1)} 格 · 最多 ${st.knockbackTargets} 隻`;
  if (st.slow) return `緩速 ${Math.round(st.slow.ratio * 100)}%`;
  if (st.blastRadiusWorld) return `範圍爆炸 · 半徑 ${st.blastRadiusWorld.toFixed(2)}`;
  return null;
}
const ENEMY_TRAIT: Partial<Record<EnemyKind, string>> = {
  mini: '成群出現，適合用砲塔清場',
  splitter: '死亡時分裂成 3 隻小果凍',
  knight: '厚甲：物理傷害減半，用冰晶塔的魔法攻擊',
  wisp: '每 2 秒治療身邊的同伴，優先擊倒',
  boss: '最終波頭目，緩速效果減半，漏掉會扣 5 點核心',
  boar: '血量低於一半時暴怒，速度提升 80%',
  ghost: '靈體：魔法傷害只吃 40%，用箭塔和砲塔對付',
  crab: '晶殼同時減免物理與魔法傷害 35%，需要大量火力',
  mole: '每 5 秒鑽入地底 2 秒，期間無法被攻擊',
  salamander: '完全無視緩速，跑得很快',
  queen: '第二關頭目：倒下時分裂成 3 隻分裂史萊姆',
  bat: '成群高速飛行，血量很低，適合砲塔與箭塔清場',
  yeti: '無視緩速、抗魔法 40%，皮粗肉厚',
  shaman: '讓身邊的同伴受到的傷害減少 35%，優先擊倒',
  frostGiant: '第三關頭目：完全無視緩速，物抗 30%',
  imp: '速度快的小惡魔，物抗 30%，用冰晶塔對付',
  phoenix: '第四關頭目：第一次倒下會浴火重生，恢復 60% 生命',
  wyvern: '飛行：直線飛越地形、路障與水面，陷阱打不到，只能靠塔擊落',
  ram: '撞上路障會停下來把它撞碎（約 3 秒），物抗 25%',
};
export const WEATHER_NAME: Record<string, string> = { clear: '晴天', rain: '微雨', snow: '飄雪', fog: '霧天' };
const ENEMY_NAMES = Object.fromEntries(Object.values(ENEMY_DEFS).map((d) => [d.kind, d.name])) as Record<EnemyKind, string>;

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
  useUi.getState().set({ selection: null, towerInfo: false });
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
  const endlessBest = useUi((s) => (level.endless ? s.progress.endless?.[level.endless.baseId] ?? 0 : 0));
  return (
    <div className="panel hud-topleft">
      <div className="hud-level">
        <span className="hud-level-tag">{level.id}</span>
        <span className="hud-level-name">{level.name}</span>
      </div>
      <div className="hud-row">
        <div className="hud-wave">
          <span className="hud-label">波次</span>
          {level.endless ? (
            <>
              <span className="hud-wave-num">{shownWave}<small> 無盡</small></span>
              <span className="hud-endless-best">最佳 {endlessBest} 波</span>
            </>
          ) : (
            <>
              <span className="hud-wave-num">{shownWave}<small>/{waveCount}</small></span>
              <div className="wave-pips">
                {Array.from({ length: waveCount }, (_, i) => (
                  <i key={i} className={i < waveIndex || (i === waveIndex && phase === 'WAVE_RESULT') ? 'done' : i === waveIndex ? 'cur' : ''} />
                ))}
              </div>
            </>
          )}
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
          <button className={`icon-btn speed ${speed > 1 ? 'on' : ''}`} title="倍速（1× → 2× → 3×）" onClick={() => { controller.flags.speed = speed === 3 ? 1 : ((speed + 1) as 2 | 3); syncStore(); audio.play('click'); }}>
            {speed}×
          </button>
        </div>
      )}
      <div className="panel hud-cam">
        <button className="icon-btn" title="向左旋轉 (Q)" aria-label="向左旋轉" onClick={() => runtime.scene?.rig.rotate(-1)}><RotateIcon dir={-1} /></button>
        <button className="icon-btn" title="向右旋轉 (E)" aria-label="向右旋轉" onClick={() => runtime.scene?.rig.rotate(1)}><RotateIcon dir={1} /></button>
        <button className="icon-btn" title="拍照模式 (P)" aria-label="拍照模式" onClick={enterPhoto}><CameraIcon /></button>
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

/** Whether this island has at least one bridge whose loss still leaves every portal a way to the core. */
const breakableCache = new Map<string, boolean>();
function bridgesBreakable(): boolean {
  let v = breakableCache.get(level.id);
  if (v === undefined) {
    const s = { ...controller.state, gold: 1e6, traps: [], brokenConnectors: [] };
    v = level.connectors.some((c) => executeCommand(level, s, { type: 'TOGGLE_BRIDGE', connectorId: c.id }).ok);
    breakableCache.set(level.id, v);
  }
  return v;
}

function Toolbar() {
  const tool = useUi((s) => s.tool);
  const gold = useUi((s) => s.gold);
  const phase = useUi((s) => s.phase);
  const canUndo = useUi((s) => s.canUndo);
  const prep = phase === 'PREPARE';
  const towersOpen = prep || phase === 'COMBAT';
  const touch = useUi((s) => s.touchUi);
  const [hoverKind, setHoverKind] = useState<TowerKind | null>(null);
  const canBreakBridges = bridgesBreakable();
  // Phones show one category at a time (towers / terrain) so every button keeps a readable size.
  const [cat, setCat] = useState<'towers' | 'terrain'>('towers');
  const shownCat = prep ? cat : 'towers'; // terrain tools only work while preparing
  const pickCat = (c: 'towers' | 'terrain') => { setCat(c); audio.play('click'); };
  const undo = (
    <button className="tool-btn undo" disabled={!prep || !canUndo} onClick={() => issue({ type: 'UNDO_PREPARE' })} title="復原 (Ctrl+Z)" aria-label="復原">
      <span className="tool-icon"><UndoIcon /></span>
      <span className="tool-label">復原</span>
    </button>
  );
  return (
    <div className={`hud-toolbar cat-${shownCat} ${towersOpen ? '' : 'locked'}`}>
      <div className="dock-tabs" role="tablist" aria-label="工具分類">
        <button role="tab" aria-selected={shownCat === 'towers'} className={`dock-tab ${shownCat === 'towers' ? 'on' : ''}`} onClick={() => pickCat('towers')}>
          <TowerIcon kind="arrow" size={18} /> 防禦塔
        </button>
        <button role="tab" aria-selected={shownCat === 'terrain'} className={`dock-tab ${shownCat === 'terrain' ? 'on' : ''}`} disabled={!prep} onClick={() => pickCat('terrain')}>
          <RaiseIcon /> 地形
        </button>
        <div className="dock-undo">{undo}</div>
      </div>
      {hoverKind && !touch && (
        <div className="panel tower-tip">
          <div className="tower-tip-title">{TOWER_DEFS[hoverKind].name}</div>
          <div className="tower-tip-stats">
            <span>傷害 {TOWER_DEFS[hoverKind].baseDamage}</span>
            <span>射程 {TOWER_DEFS[hoverKind].baseRangeWorld}</span>
            <span>{TOWER_DEFS[hoverKind].damageType === 'magic' ? '魔法' : '物理'}</span>
            {towerSpecial(hoverKind) && <span>{towerSpecial(hoverKind)}</span>}
          </div>
          <div className="tower-tip-text">{TOWER_BLURB[hoverKind]}</div>
        </div>
      )}
      <div className="panel toolbar-group towers">
        {TOWER_ORDER.map((k, i) => (
          <div key={k} onMouseEnter={() => setHoverKind(k)} onMouseLeave={() => setHoverKind(null)}>
            <ToolButton
              active={tool.type === 'build' && tool.kind === k}
              disabled={!towersOpen}
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
        <ToolButton active={tool.type === 'trap'} disabled={!prep} affordable={gold >= TRAP_DEF.cost} hotkey="J" cost={TRAP_DEF.cost} label="陷阱" icon={<TrapIcon />} onClick={() => setTool({ type: 'trap' })} tip="鋪在路上的尖刺：不擋路，地面敵人踩到就受傷，飛行怪不受影響" />
        {canBreakBridges && <ToolButton active={tool.type === 'bridge'} disabled={!prep} affordable={gold >= ECONOMY.bridgeCollapseCost} hotkey="G" cost={ECONOMY.bridgeCollapseCost} label="拆橋" icon={<BridgeIcon />} onClick={() => setTool({ type: 'bridge' })} tip={`拆掉一座橋逼敵人繞路（${ECONOMY.bridgeCollapseCost} 金），之後可花 ${ECONOMY.bridgeRepairCost} 金修回；不能切斷所有通路`} />}
      </div>
      <div className="panel toolbar-group small">{undo}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ selection */
function SelectionPanel() {
  const sel = useUi((s) => s.selection);
  const phase = useUi((s) => s.phase);
  const towerInfo = useUi((s) => s.towerInfo);
  const moving = useUi((s) => s.tool.type === 'move');
  useUi((s) => s.gold); // re-render on gold change for affordability
  if (!sel) return null;
  // a tower opens the compact action menu first; the full panel is its 資訊 button
  if (sel.type === 'tower' && (!towerInfo || moving)) return null;
  const prep = phase === 'PREPARE';
  const towersOpen = prep || phase === 'COMBAT';
  if (sel.type === 'tower') {
    const t = controller.state.towers.find((x) => x.id === sel.id);
    if (!t) return null;
    const def = TOWER_DEFS[t.kind];
    const elev = controller.elevationOf(t.anchorCellId);
    // range against a target on the same height; high ground only adds range against lower targets
    const range = def.baseRangeWorld + levelRangeBonus(t.level, t.kind, t.branch);
    const dmg = Math.round(towerStats(t.kind, t.level, t.branch).damage);
    const nextLevel = nextTowerLevel(t.level);
    const upCost = nextLevel ? upgradeCost(t.kind, nextLevel) : 0;
    // Lv3 → Lv4 is a choice between two branches, shown as cards instead of a single preview
    const choosing = nextLevel === MAX_TOWER_LEVEL;
    const next = nextLevel && !choosing ? { dmg: Math.round(towerStats(t.kind, nextLevel).damage), range: def.baseRangeWorld + levelRangeBonus(nextLevel), special: towerSpecial(t.kind, nextLevel) } : null;
    const special = towerSpecial(t.kind, t.level, t.branch);
    const hgMax = highGroundBonus(elev);
    const cells = controller.rangeForTower(t.id);
    const blocked = cells.filter((c) => c.state === 'occluded').length;
    const stats = controller.waveStats.towers[t.id];
    return (
      <div className="panel selection-panel">
        <div className="sel-head">
          <TowerIcon kind={t.kind} size={44} />
          <div>
            <div className="sel-title">{def.name}{t.branch && <span className="sel-branch">{BRANCH_DEFS[t.kind][t.branch].name}</span>}</div>
            <div className="sel-level">{'★'.repeat(t.level)}<span>{'★'.repeat(MAX_TOWER_LEVEL - t.level)}</span> Lv.{t.level}</div>
          </div>
          <button className="close-btn" onClick={clearSelection} aria-label="關閉">×</button>
        </div>
        <div className="sel-stats">
          <div><label>傷害</label><b>{dmg}</b>{next && <i className="sel-next">→{next.dmg}</i>}</div>
          <div><label>射程</label><b>{range.toFixed(1)}</b>{next && <i className="sel-next">→{next.range.toFixed(1)}</i>}</div>
          <div><label>高度</label><b>{elev}</b></div>
          {stats && <div><label>本波擊殺</label><b>{stats.kills}</b></div>}
        </div>
        {special && (
          <div className="sel-note">{special}{next?.special && next.special !== special && <span className="sel-next"> → Lv.{nextLevel}：{next.special}</span>}</div>
        )}
        {towersOpen && (
          <div className="sel-targeting" role="group" aria-label="索敵模式">
            <label title="按 T 切換">索敵</label>
            {TARGETING_MODES.map((m) => (
              <button key={m} className={`chip ${t.targeting === m ? 'on' : ''}`} title={TARGETING_TIP[m]} aria-pressed={t.targeting === m}
                onClick={() => issue({ type: 'SET_TARGETING', towerId: t.id, targeting: m })}>{TARGETING_LABEL[m]}</button>
            ))}
          </div>
        )}
        {hgMax > 0 && <div className="sel-note good">▲ 高地：打比自己低的敵人，每低 1 層射程 +{HIGH_GROUND_PER_LEVEL}（最多 +{hgMax.toFixed(1)}）</div>}
        {blocked > 0 && <div className="sel-note warn">◐ {blocked} 格被地形擋住視線（顯示為斜線）</div>}
        {towersOpen && choosing && (
          <div className="sel-branches" role="group" aria-label="Lv4 分支">
            <div className="sel-branches-head">升到 Lv4，二選一 <span className="btn-cost"><CoinIcon size={14} />{upCost}</span></div>
            {TOWER_BRANCHES.map((b) => {
              const bd = BRANCH_DEFS[t.kind][b];
              return (
                <button key={b} className="branch-card" disabled={controller.state.gold < upCost}
                  onClick={() => issue({ type: 'UPGRADE_TOWER', towerId: t.id, branch: b })}>
                  <b>{bd.name}</b>
                  <span className="branch-dmg">傷害 {Math.round(towerStats(t.kind, 4, b).damage)}</span>
                  <span className="branch-blurb">{bd.blurb}</span>
                </button>
              );
            })}
          </div>
        )}
        {towersOpen && (
          <div className="sel-actions">
            {choosing ? null : nextLevel ? (
              <button className="btn primary" disabled={controller.state.gold < upCost} onClick={() => issue({ type: 'UPGRADE_TOWER', towerId: t.id })}>
                升級 <span className="btn-cost"><CoinIcon size={14} />{upCost}</span>
              </button>
            ) : <button className="btn" disabled>已滿級</button>}
            <button className="btn" onClick={() => startTowerMove(t.id)} title="移動（M）">移動</button>
            <button className="btn danger" onClick={() => sellTower(t.id)}>
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
  const trap = (controller.state.traps ?? []).find((t) => t.cellId === c.id);
  const broken = !!conn && (controller.state.brokenConnectors ?? []).includes(conn.id);
  return (
    <div className="panel selection-panel compact">
      <div className="sel-head">
        <div>
          <div className="sel-title">{conn?.name ?? plat?.name ?? '地塊'}</div>
          <div className="sel-sub">高度 {controller.elevationOf(c.id)} · {c.editable ? '可改造地形' : '不可改造'} · {c.buildable ? '可建塔' : '不可建塔'}</div>
        </div>
        <button className="close-btn" onClick={clearSelection} aria-label="關閉">×</button>
      </div>
      {conn && <div className="sel-note">{broken ? '這座橋已被拆毀，敵人會改走其他橋。' : '此橋連接兩座浮島。橋與橋口不可改造；若還有別的通路，可用「拆橋」逼敵人繞路。'}</div>}
      {trap && <div className="sel-note">尖刺陷阱：每 {TRAP_DEF.cooldownTicks / 20} 秒對踩上來的地面敵人造成 {TRAP_DEF.damage} 點物理傷害。</div>}
      {prep && (trap || conn) && (
        <div className="sel-actions">
          {trap && (
            <button className="btn danger" onClick={() => { issue({ type: 'REMOVE_TRAP', trapId: trap.id }); clearSelection(); }}>
              拆除陷阱 <span className="btn-cost">+{TRAP_DEF.refund}</span>
            </button>
          )}
          {conn && (
            <button className="btn" onClick={() => { issue({ type: 'TOGGLE_BRIDGE', connectorId: conn.id }); clearSelection(); }}>
              {broken ? '修復橋梁' : '拆毀橋梁'} <span className="btn-cost">-{broken ? ECONOMY.bridgeRepairCost : ECONOMY.bridgeCollapseCost}</span>
            </button>
          )}
        </div>
      )}
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
  const movingTower = tool.type === 'move' ? controller.state.towers.find((t) => t.id === tool.towerId) : undefined;
  const label = tool.type === 'build' ? TOWER_DEFS[tool.kind].name : movingTower ? `移動${TOWER_DEFS[movingTower.kind].name}` : tool.type === 'raise' ? '抬升地形' : tool.type === 'lower' ? '降低地形' : tool.type === 'trap' ? '放置陷阱' : tool.type === 'bridge' ? '拆橋 / 修橋' : '放置木牆';
  return (
    <div className={`hover-chip tool ${preview ? (preview.ok ? 'ok' : 'bad') : ''}`}>
      <b>{label}</b>
      {preview
        ? (preview.ok ? <> · {movingTower ? '免費' : `花費 ${preview.cost}`}{hover ? ` · 高度 ${hover.elevation}` : ''}</> : <> · {preview.message}</>)
        : <> · {movingTower ? '選擇綠色區域放下' : touch ? '點選地塊預覽' : '選擇地塊'}</>}
      {touch
        ? <>
            {preview?.ok && <span className="chip-confirm">{movingTower ? '放開手指或再點一次確認' : '再點一次同一格確認'}</span>}
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
        <div className="swp-title">第 {waveIndex + 1} 波來襲 · {Object.values(totals).reduce((a, b) => a + (b ?? 0), 0)} 隻</div>
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
  '每波至少兩分鐘、敵人很多：戰鬥中也能用擊殺金幣建塔、升級或出售。準備好就按「開始波次」。',
];
const TUTORIAL_TOUCH = [
  '敵人會沿著發光路線走向守護之心。點下方的箭塔，再點路線旁的地塊。',
  '先點一下會預覽位置與花費，再點同一格就會建造。轉角附近能打到更多敵人。',
  '試試「抬升」地形：高地塔射程更遠。單指拖曳平移、雙指縮放或旋轉視角。',
  '每波至少兩分鐘、敵人很多：戰鬥中也能用擊殺金幣建塔、升級或出售。準備好就按「開始波次」。',
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
  const waveIndex = useUi((s) => s.waveIndex);
  const newBest = useUi((s) => s.endlessNewBest);
  const best = useUi((s) => (level.endless ? s.progress.endless?.[level.endless.baseId] ?? 0 : 0));
  if (phase !== 'DEFEAT') return null;
  return (
    <div className="modal-wrap dark">
      <div className="panel modal defeat">
        <div className="ribbon red">守護之心碎裂了</div>
        {level.endless && (
          <div className="endless-result">
            <div className="endless-waves">撐過 <b>{waveIndex}</b> 波</div>
            <div className="endless-best">{newBest && newBest === waveIndex ? '🏆 新紀錄！' : `最佳紀錄 ${best} 波`}</div>
          </div>
        )}
        <div className="failure-box">
          <div className="failure-label">失敗分析</div>
          <div className="failure-text">{text ?? '敵人突破了防線。'}</div>
        </div>
        <TowerStatsTable />
        <div className="modal-actions">
          <button className="btn primary big" disabled={!hasCp} onClick={async () => { await controller.restartFromCheckpoint(); syncStore(); useUi.getState().set({ failureText: null }); }}>
            從本波準備期重來
          </button>
          <button className="btn" onClick={() => { controller.newGame(); syncStore(); useUi.getState().set({ endlessNewBest: 0 }); }}>重新開始關卡</button>
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
  const record = useUi((s) => s.progress.records?.[level.id]);
  if (phase !== 'VICTORY') return null;
  const next = nextLevelId(level.id);
  return (
    <div className="modal-wrap soft">
      <div className="panel modal victory">
        <div className="ribbon gold">天空島守住了！</div>
        <div className="stars">
          {[1, 2, 3].map((i) => <span key={i} className={`star s${i}`} style={{ animationDelay: `${0.3 + i * 0.25}s` }}><StarIcon filled={stars >= i} size={64} /></span>)}
        </div>
        <div className="victory-sub">守護之心剩餘 {hp} 生命{record && record.clears > 1 && record.bestHp > hp ? `（最佳 ${record.bestHp}）` : record && record.clears > 1 && hp >= record.bestHp ? '・新紀錄！' : ''}</div>
        <ChallengeList final />
        <TowerStatsTable />
        <div className="modal-actions">
          {next && <button className="btn primary big" onClick={() => void launchLevel(next, false)}>下一關：{getLevel(next).name}</button>}
          <button className={`btn ${next ? '' : 'primary big'}`} onClick={() => { controller.newGame(); syncStore(); }}>再玩一次</button>
          <button className="btn ghost" onClick={() => useUi.getState().set({ screen: 'title' })}>回到標題</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ challenges */
/** Optional per-level challenges: live status in the menu, final result on victory. */
function ChallengeList({ final = false }: { final?: boolean }) {
  useUi((s) => s.gold); // refresh as the run changes
  useUi((s) => s.coreHp);
  const record = useUi((s) => s.progress.records?.[level.id]);
  const list = challengesFor(level);
  if (!list.length) return null;
  return (
    <div className="challenge-list">
      <div className="challenge-head">挑戰{record ? <small> · 已完成 {record.challenges.filter((id) => list.some((c) => c.id === id)).length}/{list.length}</small> : null}</div>
      {list.map((c) => {
        const ok = challengeMet(c, controller.state);
        const done = record?.challenges.includes(c.id);
        return (
          <div key={c.id} className={`challenge ${ok ? 'ok' : 'fail'}`}>
            <span className="challenge-mark" aria-hidden>{ok ? (final ? '✓' : '●') : '✕'}</span>
            <span className="challenge-label">{c.label}</span>
            {done && <span className="challenge-done" title="以前完成過">★</span>}
          </div>
        );
      })}
      {!final && <div className="challenge-note">● 進行中 ✕ 這局已失敗；通關時判定</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ pause / settings */
function PauseMenu() {
  const open = useUi((s) => s.pauseOpen);
  const phase = useUi((s) => s.phase);
  const [confirmRestart, setConfirmRestart] = useState(false);
  useEffect(() => { if (!open) setConfirmRestart(false); }, [open]);
  if (!open) return null;
  const close = () => { useUi.getState().set({ pauseOpen: false }); controller.flags.paused = false; syncStore(); };
  // Replay this level from wave 1: fresh state, so the core is back to full HP.
  const restartLevel = () => {
    controller.newGame();
    clearSelection();
    useUi.getState().set({ failureText: null, endlessNewBest: 0 });
    audio.play('click');
    close();
  };
  return (
    <div className="modal-wrap dark" onClick={close}>
      <div className="panel modal pause" onClick={(e) => e.stopPropagation()}>
        <div className="ribbon">{phase === 'COMBAT' ? '暫停' : '選單'}</div>
        <div className="modal-actions column">
          <button className="btn primary big" onClick={close}>繼續遊戲</button>
          <button className="btn" onClick={() => useUi.getState().set({ settingsOpen: true })}>設定</button>
          <button className="btn" onClick={() => useUi.getState().set({ helpOpen: true })}>操作說明</button>
          <button className="btn" onClick={() => { useUi.getState().set({ pauseOpen: false }); enterPhoto(); }}>拍照模式</button>
          {confirmRestart ? (
            <div className="restart-confirm">
              <div className="restart-confirm-text">從第 1 波重新開始？目前進度會清除，守護之心回滿血。</div>
              <div className="modal-actions">
                <button className="btn danger" onClick={restartLevel} autoFocus>確定重玩</button>
                <button className="btn ghost" onClick={() => setConfirmRestart(false)}>取消</button>
              </div>
            </div>
          ) : (
            <button className="btn" onClick={() => setConfirmRestart(true)}>重玩此關</button>
          )}
          <button className="btn ghost" onClick={() => { close(); useUi.getState().set({ screen: 'title' }); }}>回到標題（自動存檔）</button>
        </div>
        <ChallengeList />
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
            <Toggle label={`天氣效果${level.weather && level.weather !== 'clear' ? `（本關：${WEATHER_NAME[level.weather]}）` : ''}`} value={s.weather !== false} onChange={(v) => update({ weather: v })} />
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
    ['Q / E', '旋轉視角'], ['P', '拍照模式（隱藏介面、自由視角、濾鏡、截圖）'], ['滾輪 / + -', '縮放'], ['WASD / 中鍵拖曳', '平移'], ['Enter', '開始波次 / 繼續'], ['Space', '暫停'],
    ['觸控', '單指拖曳平移、雙指縮放 / 旋轉、點兩下確認放置'],
  ];
  return (
    <div className="modal-wrap dark" onClick={() => useUi.getState().set({ helpOpen: false })}>
      <div className="panel modal help" onClick={(e) => e.stopPropagation()}>
        <div className="ribbon">操作說明</div>
        <div className="help-grid">{rows.map(([k, v]) => <div key={k} className="help-row"><kbd>{k}</kbd><span>{v}</span></div>)}</div>
        <div className="help-enemies">
          {(Object.keys(ENEMY_DEFS) as EnemyKind[]).map((k) => (
            <div key={k} className="help-enemy"><EnemyIcon kind={k} size={26} /><b>{ENEMY_NAMES[k]}</b><span>生命 {ENEMY_DEFS[k].hp} · 速度 {ENEMY_DEFS[k].speedCellsPerSecond}{ENEMY_DEFS[k].physicalResistance ? ` · 物抗 ${Math.round(ENEMY_DEFS[k].physicalResistance * 100)}%` : ''}{ENEMY_TRAIT[k] ? ` · ${ENEMY_TRAIT[k]}` : ''}</span></div>
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
  const photo = useUi((s) => !!s.photo);
  if (photo) {
    return (
      <div className={`hud photo ${touch ? 'touch' : ''}`} style={{ ['--ui-scale' as string]: scale }}>
        <PhotoPanel />
        <Toasts />
      </div>
    );
  }
  return (
    <div className={`hud ${intro ? 'intro' : ''} ${touch ? 'touch' : ''}`} style={{ ['--ui-scale' as string]: scale }}>
      <TopLeft />
      <TopRight />
      <Tutorial />
      <ToolHint />
      <TowerMenu />
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
