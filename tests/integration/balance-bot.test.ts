import { expect, it } from 'vitest';
import { level, fresh } from '../unit/helpers';
import { executeCommand, resolveTowerFootprint } from '../../src/commands/execute';
import { advanceOneTick } from '../../src/simulation/engine';
import { computeRoutes } from '../../src/navigation/connectivity';
import { deriveMap } from '../../src/navigation/derived-map';
import { sampleTowerRange } from '../../src/navigation/line-of-sight';
import type { GameState, TowerKind } from '../../src/domain/types';

function bestAnchor(s: GameState, kind: TowerKind) {
  const map = deriveMap(level, s);
  let best: { id: string; score: number } | null = null;
  for (const c of level.cells) {
    const fp = resolveTowerFootprint(map, c.id);
    if (!fp.ok) continue;
    const draft = { ...s, towers: [...s.towers, { id: 'x', kind, anchorCellId: c.id, footprintCellIds: fp.cellIds, level: 1 as const, cooldownTicks: 0, investedGold: 0, targeting: 'FIRST' as const, builtWave: 0 }] };
    const r = computeRoutes(level, draft);
    if (!r.ok) continue;
    const cells = new Set([...r.routes.A!, ...r.routes.B!]);
    const samples = sampleTowerRange(deriveMap(level, draft), { kind, level: 1, anchorCellId: c.id, footprintCellIds: fp.cellIds });
    let score = 0;
    for (const sm of samples) if (sm.state === 'visible' && cells.has(sm.cellId)) score += (r.routes.A!.includes(sm.cellId) ? 1 : 0) + (r.routes.B!.includes(sm.cellId) ? 1 : 0);
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best;
}
it('greedy coverage bot clears all five waves (balance report)', () => {
  let s = fresh();
  const order: TowerKind[][] = [['arrow', 'arrow'], ['frost'], ['cannon'], ['arrow'], ['cannon']];
  for (let w = 0; w < 5; w++) {
    for (const k of order[w]!) {
      const b = bestAnchor(s, k);
      if (!b) continue;
      const r = executeCommand(level, s, { type: 'BUILD_TOWER', kind: k, anchorCellId: b.id });
      if (r.ok) s = r.state;
    }
    for (const t of s.towers) { const r = executeCommand(level, s, { type: 'UPGRADE_TOWER', towerId: t.id }); if (r.ok) s = r.state; }
    const st = executeCommand(level, s, { type: 'START_WAVE' }); if (!st.ok) throw new Error(st.message); s = st.state;
    let leaks = 0;
    while (s.phase === 'COMBAT') { const t = advanceOneTick(s, level); s = t.state; leaks += t.events.filter((e) => e.type === 'ENEMY_REACHED_CORE').length; }
    console.log('wave', w + 1, s.phase, 'hp', s.coreHp, 'gold', s.gold, 'leaks', leaks, 'towers', s.towers.map((t) => t.kind + t.level).join(','));
    if (s.phase !== 'WAVE_RESULT') break;
    s = executeCommand(level, s, { type: 'CONTINUE' }).state;
  }
  expect(s.phase).toBe('VICTORY');
});
