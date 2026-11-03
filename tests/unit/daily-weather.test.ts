import { describe, expect, it } from 'vitest';
import { dailyIdFor, isDailyId, makeDailyLevel, todayString, dailySpec } from '../../src/levels/daily';
import { getPlayableLevel, isPlayableId, getLevel, LEVEL_IDS } from '../../src/levels/registry';
import { validateLevel } from '../../src/levels/level-validator';
import { LevelDefSchema, SettingsSchema } from '../../src/domain/schemas';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';

describe('daily seeded challenge', () => {
  it('ids round-trip and are playable', () => {
    expect(todayString(new Date(2026, 10, 3))).toBe('2026-11-03');
    expect(dailyIdFor('2026-11-03')).toBe('D-2026-11-03');
    expect(isDailyId('D-2026-11-03')).toBe(true);
    expect(isDailyId('L1-01')).toBe(false);
    expect(isPlayableId('D-2026-11-03')).toBe(true);
    expect(getPlayableLevel('D-2026-11-03').id).toBe('D-2026-11-03');
  });
  it('the same date always gives the same island; different dates differ', () => {
    expect(JSON.stringify(dailySpec('2026-04-01'))).toBe(JSON.stringify(dailySpec('2026-04-01')));
    expect(JSON.stringify(makeDailyLevel('2026-04-01').cells)).not.toBe(JSON.stringify(makeDailyLevel('2026-04-02').cells));
  });
  it('a month of dailies are all valid levels with a modifier', () => {
    for (let d = 1; d <= 30; d++) {
      const date = `2026-06-${String(d).padStart(2, '0')}`;
      const l = makeDailyLevel(date);
      expect(validateLevel(l).errors, date).toEqual([]);
      expect(LevelDefSchema.safeParse(l).success, date).toBe(true);
      expect(l.daily?.date).toBe(date);
      expect(l.daily?.modifiers.length).toBe(1);
    }
  });
});

describe('weather (presentation only)', () => {
  it('islands carry a weather tag that the schema accepts', () => {
    const tagged = LEVEL_IDS.map((id) => getLevel(id)).filter((l) => l.weather && l.weather !== 'clear');
    expect(new Set(tagged.map((l) => l.weather))).toEqual(new Set(['rain', 'snow', 'fog']));
    for (const l of tagged) expect(LevelDefSchema.safeParse(l).success).toBe(true);
  });
  it('older settings without the weather flag still load, defaulting to on', () => {
    const { weather: _w, ...old } = DEFAULT_SETTINGS;
    void _w;
    const parsed = SettingsSchema.parse(old);
    expect(parsed.weather).toBe(true);
  });
});
