import { describe, expect, it } from 'vitest';
import {
  buildCustomLevel, CustomSpecSchema, decodeCustom, defaultCustomSpec, encodeCustom, findValidSeed, isCustomId, registerCustom,
} from '../../src/levels/custom';
import { getPlayableLevel, isPlayableId } from '../../src/levels/registry';

describe('custom levels (editor + share links)', () => {
  it('the default editor spec is a valid, playable island', () => {
    const r = buildCustomLevel(defaultCustomSpec());
    expect(r.ok).toBe(true);
  });

  it('share codes round-trip and are URL safe', () => {
    const spec = { ...defaultCustomSpec(), name: '測試島 ✦', overrides: { '15,15': 'raise' as const } };
    const code = encodeCustom(spec);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeCustom(code);
    expect(back.ok && back.spec).toEqual(spec);
  });

  it('rejects untrusted input that is malformed, unknown or oversized', () => {
    const bad = (o: unknown) => decodeCustom(Buffer.from(JSON.stringify(o)).toString('base64url'));
    expect(decodeCustom('!!!').ok).toBe(false);
    expect(bad({ ...defaultCustomSpec(), plan: { ...defaultCustomSpec().plan, roster: ['dragonGod'] } }).ok).toBe(false);
    expect(bad({ ...defaultCustomSpec(), plan: { ...defaultCustomSpec().plan, waves: 999 } }).ok).toBe(false);
    expect(bad({ ...defaultCustomSpec(), v: 2 }).ok).toBe(false);
    const many: Record<string, string> = {};
    for (let i = 0; i < 31; i++) for (let j = 0; j < 31; j++) many[`${i},${j}`] = 'raise';
    expect(CustomSpecSchema.safeParse({ ...defaultCustomSpec(), overrides: many }).success).toBe(false);
    expect(decodeCustom('a'.repeat(12_001)).ok).toBe(false);
  });

  it('cell edits change the island and broken edits are reported', () => {
    const spec = defaultCustomSpec();
    const base = buildCustomLevel(spec);
    if (!base.ok) throw new Error('default invalid');
    const pc = base.level.cells.find((c) => c.id === base.level.portals[0]!.cellId)!;
    const key = `${pc.pos.x},${pc.pos.z}`;
    const voided = buildCustomLevel({ ...spec, overrides: { [key]: 'void' } });
    expect(voided.ok).toBe(false);

    const ground = base.level.cells.find((c) => c.pos.x === 12 && c.pos.z === 12);
    expect(ground).toBeTruthy();
    const raised = buildCustomLevel({ ...spec, overrides: { '12,12': 'raise' } });
    expect(raised.level).toBeTruthy();
    const after = raised.level!.cells.find((c) => c.pos.x === 12 && c.pos.z === 12);
    expect(after?.elevation).toBeGreaterThan(ground!.elevation);
  });

  it('findValidSeed only returns seeds that validate', () => {
    const spec = defaultCustomSpec();
    for (const start of [1, 4242, 77777]) {
      const seed = findValidSeed(spec, start);
      expect(buildCustomLevel({ ...spec, seed, overrides: {} }).ok).toBe(true);
    }
  });

  it('registered custom levels are playable by id', () => {
    const r = registerCustom(defaultCustomSpec());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isCustomId(r.id)).toBe(true);
    expect(isPlayableId(r.id)).toBe(true);
    expect(getPlayableLevel(r.id)?.id).toBe(r.id);
  });
});
