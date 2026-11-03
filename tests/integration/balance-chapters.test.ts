import { describe, expect, it } from 'vitest';
import { runBot, type BotOptions, type RunReport } from './bot';
import { getLevel, LEVEL_IDS, type LevelId } from '../../src/levels/registry';

/**
 * Balance for the generated islands (L1-05, chapters 2 and 3). Same bot families as the authored
 * levels; the tower cap grows with the number of portals. The coverage-greedy activeB bot must win
 * without a perfect score, and a player who only builds between waves must lose.
 */
const GENERATED = LEVEL_IDS.slice(4) as LevelId[];
const mixA: BotOptions['mix'] = ['arrow', 'arrow', 'frost', 'cannon', 'arrow', 'frost', 'cannon'];
const cap = (id: LevelId) => 10 + 4 * getLevel(id).portals.length;
const PROFILES = (c: number): Record<string, BotOptions> => ({
  activeB: { mix: ['arrow', 'frost', 'arrow', 'cannon'], maxTowers: c + 2, combatSpendEvery: 100, minScore: 3, upgradeAfter: 10, spread: true },
  prepOnly: { mix: mixA, maxTowers: 16, combatSpendEvery: 0, minScore: 4, upgradeAfter: 7 },
});

const reports: Record<string, RunReport> = {};
function run(id: LevelId, name: string): RunReport {
  const key = `${id}:${name}`;
  if (!reports[key]) {
    const r = runBot(PROFILES(cap(id))[name]!, getLevel(id));
    console.log(`== ${id} ${name}: ${r.result} core ${r.coreHp}/20`);
    for (const w of r.waves) console.log(`   w${w.wave} ${w.seconds.toFixed(1)}s enemies ${w.enemies} leaks ${w.leaks} ${JSON.stringify(w.leakKinds)} hp ${w.hpAfter} gold ${w.goldAfter}`);
    reports[key] = r;
  }
  return reports[key];
}

describe.each(GENERATED)('%s balance (bots)', (id) => {
  it('an active, wide defence wins, but not untouched', () => {
    const r = run(id, 'activeB');
    expect(r.result).toBe('VICTORY');
    expect(r.coreHp).toBeLessThan(20);
    for (const w of r.waves) expect(w.seconds, `wave ${w.wave}`).toBeGreaterThanOrEqual(120);
  }, 600_000);
  it('a player who only builds between waves loses', () => {
    const r = run(id, 'prepOnly');
    expect(r.result).toBe('DEFEAT');
  }, 600_000);
});
