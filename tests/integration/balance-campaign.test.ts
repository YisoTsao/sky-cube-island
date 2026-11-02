import { describe, expect, it } from 'vitest';
import { runBot, type BotOptions, type RunReport } from './bot';
import { getLevel, type LevelId } from '../../src/levels/registry';

/**
 * Balance reports for L1-03 and L1-04. Same bot families as the earlier levels (greedy route
 * coverage, no terrain edits); the tower caps grow with the number of portals.
 */
const mixA: BotOptions['mix'] = ['arrow', 'arrow', 'frost', 'cannon', 'arrow', 'frost', 'cannon'];
const PROFILES = (cap: number): Record<string, BotOptions> => ({
  active: { mix: mixA, maxTowers: cap, combatSpendEvery: 200, minScore: 3, upgradeAfter: 10 },
  activeB: { mix: ['arrow', 'frost', 'arrow', 'cannon'], maxTowers: cap + 2, combatSpendEvery: 100, minScore: 3, upgradeAfter: 10 },
  prepOnly: { mix: mixA, maxTowers: 16, combatSpendEvery: 0, minScore: 4, upgradeAfter: 7 },
  sloppy: { mix: ['arrow', 'cannon', 'frost'], maxTowers: 16, combatSpendEvery: 600, minScore: 2, upgradeAfter: 30, spendRatio: 0.6 },
});
const CAPS: Record<string, number> = { 'L1-03': 22, 'L1-04': 26 };

const reports: Record<string, RunReport> = {};
function run(id: LevelId, name: string): RunReport {
  const key = `${id}:${name}`;
  if (!reports[key]) {
    const r = runBot(PROFILES(CAPS[id]!)[name]!, getLevel(id));
    console.log(`== ${id} ${name}: ${r.result} core ${r.coreHp}/20`);
    for (const w of r.waves) console.log(`   w${w.wave} ${w.seconds.toFixed(1)}s enemies ${w.enemies} leaks ${w.leaks} ${JSON.stringify(w.leakKinds)} hp ${w.hpAfter} gold ${w.goldAfter} [${w.towers}]`);
    reports[key] = r;
  }
  return reports[key];
}

describe.each(['L1-03', 'L1-04'] as const)('%s balance (bots)', (id) => {
  // Three-plus portals reward a wide spread of towers: the coverage-greedy activeB bot is the
  // reference "good player"; the other profiles are logged for tuning.
  it('an active, wide defence wins, but not untouched', () => {
    const r = run(id, 'activeB');
    expect(r.result).toBe('VICTORY');
    expect(r.coreHp).toBeLessThan(20);
    for (const w of r.waves) {
      expect(w.seconds, `wave ${w.wave}`).toBeGreaterThanOrEqual(120);
      expect(w.enemies, `wave ${w.wave}`).toBeGreaterThanOrEqual(90);
    }
  }, 300_000);
  it('a player who only builds between waves loses', () => {
    const r = run(id, 'prepOnly');
    expect(r.result).toBe('DEFEAT');
    expect(r.waves.length).toBeGreaterThanOrEqual(3);
  }, 300_000);
  it('logs the other profiles', () => {
    for (const name of ['active', 'sloppy']) expect(['VICTORY', 'DEFEAT']).toContain(run(id, name).result);
  }, 300_000);
});
