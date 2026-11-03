import { describe, expect, it } from 'vitest';
import { runBot } from './bot';
import { makeDailyLevel } from '../../src/levels/daily';

/**
 * Daily challenges are generated without hand tuning, so they are checked over a spread of dates:
 * a good, spread-out defence should clear most days, and building only between waves must not be
 * a reliable way to win. v2.9 (D-37): Lv4 branches let a player who banks gold between waves turn
 * it into power on a few spots, so that bot now wins 5 of the 8 sample days (was ≤ 3); the cap is
 * kept below the good defence's floor so a passive player can never beat every day.
 */
const DATES = ['2026-01-01', '2026-02-14', '2026-03-21', '2026-05-05', '2026-07-07', '2026-09-30', '2026-11-03', '2026-12-25'];

describe('daily challenge balance (bots)', () => {
  it('a good defence clears most days; prep-only players lose most days', () => {
    let wins = 0, prepWins = 0;
    for (const d of DATES) {
      const l = makeDailyLevel(d);
      const a = runBot({ mix: ['arrow', 'frost', 'arrow', 'cannon'], maxTowers: 12 + 4 * l.portals.length, combatSpendEvery: 100, minScore: 3, upgradeAfter: 10, spread: true }, l);
      const p = runBot({ mix: ['arrow', 'arrow', 'frost', 'cannon', 'arrow', 'frost', 'cannon'], maxTowers: 16, combatSpendEvery: 0, minScore: 4, upgradeAfter: 7 }, l);
      console.log(`== ${d} ${l.name} P${l.portals.length} ${l.daily?.modifiers[0]}: good ${a.result} ${a.coreHp} @w${a.waves.length} | prep ${p.result} ${p.coreHp} @w${p.waves.length}`);
      if (a.result === 'VICTORY') wins++;
      if (p.result === 'VICTORY') prepWins++;
    }
    expect(wins).toBeGreaterThanOrEqual(6);
    expect(prepWins).toBeLessThanOrEqual(5);
    expect(prepWins).toBeLessThan(wins);
  }, 900_000);
});
