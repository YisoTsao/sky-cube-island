import { useEffect, useRef, type ReactElement } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { BRANCH_LEVEL, TOWER_DEFS, nextTowerLevel, sellRefund, upgradeCost } from '../domain/definitions';
import { controller, runtime } from '../app/runtime';
import { useUi } from '../state/store';
import { audio } from '../audio/audio';
import { issue, setTool } from './GameView';
import { CoinIcon, InfoIcon, MoveIcon, SellIcon, UpgradeIcon } from './icons';

/** Radius of the button arc around the tower's head, in CSS px (before --ui-scale). */
const RADIUS = 74;
/** The four buttons sit on an arc over the tower: left → right. */
const ANGLES = [-162, -114, -66, -18];
/** Keep the arc's buttons on screen when the tower is near an edge. */
const EDGE = RADIUS + 34;

export function towerActionsOpen(phase: string): boolean { return phase === 'PREPARE' || phase === 'COMBAT'; }

export function openTowerInfo() {
  useUi.getState().set({ towerInfo: true });
  audio.play('click', { vol: 0.5 });
}

/** Pick the tower up: the map lights every spot it may go, the next click/tap puts it down. */
export function startTowerMove(towerId: string) {
  const u = useUi.getState();
  if (!towerActionsOpen(u.phase)) return;
  if (u.tool.type === 'move' && u.tool.towerId === towerId) return;
  setTool({ type: 'move', towerId });
  const n = controller.moveTargets(towerId).size;
  if (n === 0) useUi.getState().toast('附近沒有可以放下這座塔的空地', 'error');
}

export function sellTower(towerId: string) {
  if (issue({ type: 'SELL_TOWER', towerId })) {
    useUi.getState().set({ selection: null, towerInfo: false });
    runtime.scene?.setSelection(null);
  }
}

/**
 * Compact action menu that pops out around a clicked tower (upgrade / sell / move / info); the full
 * stats panel only opens from 資訊. Follows the tower on screen every frame (one DOM node, no React
 * renders per frame).
 */
export function TowerMenu(): ReactElement {
  const sel = useUi((s) => s.selection);
  const info = useUi((s) => s.towerInfo);
  const toolType = useUi((s) => s.tool.type);
  const phase = useUi((s) => s.phase);
  const reduced = useUi((s) => s.settings.reducedMotion);
  const scale = useUi((s) => s.settings.uiScale) || 1;
  useUi((s) => s.gold); // affordability
  const anchorRef = useRef<HTMLDivElement>(null);
  const tower = sel?.type === 'tower' ? controller.state.towers.find((t) => t.id === sel.id) : undefined;
  const open = !!tower && !info && toolType === 'none';
  const towerId = tower?.id;

  useEffect(() => {
    if (!open || !towerId) return;
    let raf = 0;
    const follow = () => {
      raf = requestAnimationFrame(follow);
      const el = anchorRef.current;
      const s = runtime.scene?.towerScreen(towerId);
      if (!el || !s) return;
      const m = EDGE * scale;
      const x = Math.min(Math.max(s.x, m), innerWidth - m);
      const y = Math.min(Math.max(s.y, m + 10), innerHeight - 40 * scale);
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.visibility = s.visible ? 'visible' : 'hidden';
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, [open, towerId, scale]);

  const actions = towerActionsOpen(phase);
  let items: { key: string; label: string; icon: ReactElement; tone: string; badge?: ReactElement | string; disabled?: boolean; hotkey: string; onClick: () => void }[] = [];
  if (tower) {
    const next = nextTowerLevel(tower.level);
    const cost = next ? upgradeCost(tower.kind, next) : 0;
    const branch = next === BRANCH_LEVEL;
    items = [
      {
        key: 'upgrade', label: !next ? '滿級' : '升級', icon: <UpgradeIcon />, tone: 'up', hotkey: 'U',
        // short of gold: say how much is missing instead of leaving a silent grey button
        badge: next ? (controller.state.gold < cost ? `還差 ${cost - controller.state.gold}` : <><CoinIcon size={12} />{cost}</>) : undefined,
        disabled: !actions || !next || controller.state.gold < cost,
        // Lv3 → Lv4 is a choice between two branches, which needs the full panel's cards
        onClick: () => (branch ? openTowerInfo() : issue({ type: 'UPGRADE_TOWER', towerId: tower.id })),
      },
      { key: 'sell', label: '出售', icon: <SellIcon />, tone: 'sell', hotkey: 'X', badge: `+${sellRefund(tower.investedGold)}`, disabled: !actions, onClick: () => sellTower(tower.id) },
      { key: 'move', label: '移動', icon: <MoveIcon />, tone: 'move', hotkey: 'M', badge: '免費', disabled: !actions, onClick: () => startTowerMove(tower.id) },
      { key: 'info', label: '資訊', icon: <InfoIcon />, tone: 'info', hotkey: 'I', onClick: openTowerInfo },
    ];
  }

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div ref={anchorRef} className="tower-menu-anchor">
        <AnimatePresence>
          {open && tower && (
            <motion.div key={tower.id} className="tower-menu" role="menu" aria-label={`${TOWER_DEFS[tower.kind].name} 操作`}
              initial="closed" animate="open" exit="closed">
              <motion.div className="tower-menu-name"
                variants={{ closed: { opacity: 0, y: 8, scale: 0.8 }, open: { opacity: 1, y: 0, scale: 1 } }}
                transition={{ type: 'spring', stiffness: 520, damping: 30 }}>
                {TOWER_DEFS[tower.kind].name} <span>Lv.{tower.level}</span>
              </motion.div>
              {items.map((it, i) => {
                const a = (ANGLES[i]! * Math.PI) / 180;
                const x = Math.cos(a) * RADIUS * scale, y = Math.sin(a) * RADIUS * scale;
                return (
                  <motion.button key={it.key} role="menuitem" type="button"
                    className={`tower-menu-btn tone-${it.tone}`} disabled={it.disabled} title={`${it.label}（${it.hotkey}）`}
                    variants={{
                      closed: { x: 0, y: 0, scale: 0.2, opacity: 0, transition: { duration: 0.12, delay: (items.length - 1 - i) * 0.02 } },
                      open: { x, y, scale: 1, opacity: 1,
                        transition: { type: 'spring', stiffness: 460, damping: 22, mass: 0.7, delay: i * 0.045 } },
                    }}
                    whileHover={it.disabled ? undefined : { scale: 1.1 }}
                    whileTap={it.disabled ? undefined : { scale: 0.9 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); if (!it.disabled) it.onClick(); }}>
                    <span className="tmb-disc">{it.icon}</span>
                    <span className="tmb-label">{it.label}</span>
                    {it.badge && <span className="tmb-badge">{it.badge}</span>}
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
