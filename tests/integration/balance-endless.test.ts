import { describe, expect, it } from 'vitest';
import { runBot, type BotOptions } from './bot';
import { getLevel, LEVEL_IDS } from '../../src/levels/registry';
import { makeEndlessLevel } from '../../src/levels/endless';

/**
 * Endless mode balance: the same "good player" bot that wins the campaign level must clear a
 * respectable number of endless waves, but the compounding HP must eventually win.
 */
const CAPS: Record<string, number> = { 'L1-01': 18, 'L1-02': 20, 'L1-03': 22, 'L1-04': 26 };
const good = (cap: number): BotOptions => ({ mix: ['arrow', 'frost', 'arrow', 'cannon'], maxTowers: cap + 2, combatSpendEvery: 100, minScore: 3, upgradeAfter: 10 });

describe.each(LEVEL_IDS)('%s endless (bot)', (id) => {
  it('a good defence lasts a while but eventually falls', () => {
    const level = makeEndlessLevel(getLevel(id));
    const r = runBot(good(CAPS[id]!), level);
    console.log(`== ${level.id}: ${r.result} after ${r.waves.length} waves`);
    for (const w of r.waves) console.log(`   w${w.wave} ${w.seconds.toFixed(1)}s enemies ${w.enemies} leaks ${w.leaks} ${JSON.stringify(w.leakKinds)} hp ${w.hpAfter} gold ${w.goldAfter}`);
    expect(r.result).toBe('DEFEAT');
    expect(r.waves.length).toBeGreaterThanOrEqual(8);
    expect(r.waves.length).toBeLessThanOrEqual(45);
  }, 600_000);
});
