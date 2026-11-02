import { describe, expect, it } from 'vitest';
import { runBot, type BotOptions, type RunReport } from './bot';

/**
 * Balance report for L1-01 (v2.2). Bots place towers greedily by route coverage and never touch
 * terrain or walls, so a human who also reshapes the route has more room than these numbers show.
 */
const PROFILES: Record<string, BotOptions> = {
  // Reinvests every 10 s mid-wave, mixed towers, upgrades once six towers are up.
  active: { mix: ['arrow', 'arrow', 'frost', 'cannon', 'arrow', 'frost', 'cannon'], maxTowers: 14, combatSpendEvery: 200, minScore: 4, upgradeAfter: 6 },
  // Reinvests every 5 s, frost-heavier mix.
  activeB: { mix: ['arrow', 'frost', 'arrow', 'cannon'], maxTowers: 16, combatSpendEvery: 100, minScore: 3, upgradeAfter: 10 },
  // Only spends between waves: gold piles up during the long waves.
  prepOnly: { mix: ['arrow', 'arrow', 'frost', 'cannon', 'arrow', 'frost', 'cannon'], maxTowers: 14, combatSpendEvery: 0, minScore: 4, upgradeAfter: 6 },
  // Keeps 40 % of gold idle and rarely reinvests.
  sloppy: { mix: ['arrow', 'cannon', 'frost'], maxTowers: 14, combatSpendEvery: 600, minScore: 2, upgradeAfter: 30, spendRatio: 0.6 },
};

const reports: Record<string, RunReport> = {};
const run = (name: string) => (reports[name] ??= runBot(PROFILES[name]!));
function log(name: string, r: RunReport) {
  console.log(`== ${name}: ${r.result} core ${r.coreHp}/20`);
  for (const w of r.waves) console.log(`   w${w.wave} ${w.seconds.toFixed(1)}s enemies ${w.enemies} leaks ${w.leaks} ${JSON.stringify(w.leakKinds)} hp ${w.hpAfter} gold ${w.goldAfter} [${w.towers}]`);
}

describe('L1-01 balance (bots)', () => {
  it.each(['active', 'activeB'])('%s player wins, but not untouched', (name) => {
    const r = run(name); log(name, r);
    expect(r.result).toBe('VICTORY');
    expect(r.coreHp).toBeLessThan(20);
    for (const w of r.waves) {
      expect(w.seconds, `wave ${w.wave}`).toBeGreaterThanOrEqual(120);
      expect(w.enemies, `wave ${w.wave}`).toBeGreaterThanOrEqual(90);
    }
  }, 120_000);
  it.each(['prepOnly', 'sloppy'])('%s player loses', (name) => {
    const r = run(name); log(name, r);
    expect(r.result).toBe('DEFEAT');
    // ...but survives the opening waves, so the loss comes from the late-game pressure.
    expect(r.waves.length).toBeGreaterThanOrEqual(3);
  }, 120_000);
});
