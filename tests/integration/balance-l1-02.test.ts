import { describe, expect, it } from 'vitest';
import { runBot, type BotOptions, type RunReport } from './bot';
import { generateL1_02 } from '../../src/levels/l1-02.generator';

/**
 * Balance report for L1-02. Same bot profiles as L1-01 (greedy route coverage, no terrain edits).
 * Three portals split the pressure, so an active player needs a wider tower spread.
 */
const level = generateL1_02();
const PROFILES: Record<string, BotOptions> = {
  active: { mix: ['arrow', 'arrow', 'frost', 'cannon', 'arrow', 'frost', 'cannon'], maxTowers: 20, combatSpendEvery: 200, minScore: 4, upgradeAfter: 7 },
  activeB: { mix: ['arrow', 'frost', 'arrow', 'cannon'], maxTowers: 22, combatSpendEvery: 100, minScore: 3, upgradeAfter: 10 },
  prepOnly: { mix: ['arrow', 'arrow', 'frost', 'cannon', 'arrow', 'frost', 'cannon'], maxTowers: 16, combatSpendEvery: 0, minScore: 4, upgradeAfter: 7 },
  sloppy: { mix: ['arrow', 'cannon', 'frost'], maxTowers: 16, combatSpendEvery: 600, minScore: 2, upgradeAfter: 30, spendRatio: 0.6 },
};

const reports: Record<string, RunReport> = {};
const run = (name: string) => (reports[name] ??= runBot(PROFILES[name]!, level));
function log(name: string, r: RunReport) {
  console.log(`== L1-02 ${name}: ${r.result} core ${r.coreHp}/20`);
  for (const w of r.waves) console.log(`   w${w.wave} ${w.seconds.toFixed(1)}s enemies ${w.enemies} leaks ${w.leaks} ${JSON.stringify(w.leakKinds)} hp ${w.hpAfter} gold ${w.goldAfter} [${w.towers}]`);
}

describe('L1-02 balance (bots)', () => {
  it.each(['active', 'activeB'])('%s player wins, but not untouched', (name) => {
    const r = run(name); log(name, r);
    expect(r.result).toBe('VICTORY');
    expect(r.coreHp).toBeLessThan(20);
    for (const w of r.waves) {
      expect(w.seconds, `wave ${w.wave}`).toBeGreaterThanOrEqual(120);
      expect(w.enemies, `wave ${w.wave}`).toBeGreaterThanOrEqual(90);
      expect(w.enemies, `wave ${w.wave}`).toBeLessThanOrEqual(260);
    }
  }, 180_000);
  it.each(['prepOnly', 'sloppy'])('%s player loses', (name) => {
    const r = run(name); log(name, r);
    expect(r.result).toBe('DEFEAT');
    expect(r.waves.length).toBeGreaterThanOrEqual(3);
  }, 180_000);
});
