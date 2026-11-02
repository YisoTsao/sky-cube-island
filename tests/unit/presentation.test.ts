import { describe, expect, it } from 'vitest';
import { ALL_EVENT_TYPES } from '../../src/domain/types';
import { DIRECTOR_REACTIONS } from '../../src/scene/director-map';
import { SFX_FOR_EVENT } from '../../src/audio/sfx-registry';
import { analyseFailure, emptyWaveStats, foldWaveStats } from '../../src/presentation/stats';

describe('presentation coverage (Tech §9.9)', () => {
  it('every GameEvent type has a director reaction and an audio mapping', () => {
    for (const t of ALL_EVENT_TYPES) {
      expect(DIRECTOR_REACTIONS[t], t).toBeTypeOf('string');
      expect(SFX_FOR_EVENT[t], t).toBeDefined();
    }
    expect(Object.keys(DIRECTOR_REACTIONS).sort()).toEqual([...ALL_EVENT_TYPES].sort());
    expect(Object.keys(SFX_FOR_EVENT).sort()).toEqual([...ALL_EVENT_TYPES].sort());
  });
});

describe('wave stats fold', () => {
  it('accumulates damage, kills, leaks and resets on WAVE_STARTED', () => {
    let s = emptyWaveStats(0);
    s = foldWaveStats(s, { type: 'WAVE_STARTED', tick: 0, waveIndex: 1 });
    s = foldWaveStats(s, { type: 'ENEMY_DAMAGED', tick: 1, enemyId: 'e1', sourceTowerId: 't1', amount: 20, hpAfter: 40, resisted: false } as never);
    s = foldWaveStats(s, { type: 'ENEMY_KILLED', tick: 2, enemyId: 'e1', kind: 'slime', killerTowerId: 't1', gold: 6 } as never);
    s = foldWaveStats(s, { type: 'ENEMY_REACHED_CORE', tick: 3, enemyId: 'e2', kind: 'golem', portalId: 'A', lastNodeIds: ['c1_1'] } as never);
    s = foldWaveStats(s, { type: 'WAVE_CLEARED', tick: 4, waveIndex: 1, clearGold: 30 });
    expect(s.waveIndex).toBe(1);
    expect(s.towers.t1).toEqual({ towerId: 't1', damage: 20, kills: 1 });
    expect(s.kills).toBe(1);
    expect(s.goldEarned).toBe(36);
    expect(s.leaksByPortal.A).toBe(1);
    expect(s.leakKinds.golem).toBe(1);
    s = foldWaveStats(s, { type: 'WAVE_STARTED', tick: 5, waveIndex: 2 });
    expect(s.kills).toBe(0);
  });

  it('failure analysis names the longest uncovered stretch', () => {
    const stats = { ...emptyWaveStats(0), leaksByPortal: { A: 3 } };
    const route = ['a', 'b', 'c', 'd', 'e', 'f'];
    const text = analyseFailure({
      stats, routes: { A: route }, covered: new Set(['a', 'f']), towerCount: 2,
      placeOf: () => '西浮島', portalName: () => '入口 A',
    });
    expect(text).toContain('入口 A');
    expect(text).toContain('西浮島');
    expect(text).toContain('4 格');
  });

  it('failure analysis without towers suggests building', () => {
    const text = analyseFailure({
      stats: { ...emptyWaveStats(0), leaksByPortal: { B: 1 } }, routes: {}, covered: new Set(), towerCount: 0,
      placeOf: () => '', portalName: () => '入口 B',
    });
    expect(text).toContain('沒有防禦塔');
  });
});
