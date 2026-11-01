import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSave, parseSave, readCheckpoint, readSave, toSaveFile, writeCheckpoint, writeSave } from '../../src/persistence/save';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/settings/settings';
import { executeCommand } from '../../src/commands/execute';
import { fresh, level } from './helpers';

describe('save round-trip (IndexedDB)', () => {
  beforeEach(async () => { await clearSave(); });

  it('writes and reads back an identical PREPARE state', async () => {
    let s = fresh();
    const r = executeCommand(level, s, { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: 'c14_13' });
    if (r.ok) s = r.state;
    expect(await writeSave(s)).toBe(true);
    const back = await readSave(level.id);
    expect(back).toEqual(s);
  });

  it('checkpoint is stored separately', async () => {
    const s = fresh();
    await writeCheckpoint(s);
    expect(await readSave(level.id)).toBeNull();
    expect(await readCheckpoint(level.id)).toEqual(s);
  });

  it('rejects saves for another level or corrupted data', () => {
    const file = toSaveFile(fresh());
    expect(parseSave(file, 'other-level')).toBeNull();
    expect(parseSave({ nonsense: true }, level.id)).toBeNull();
    expect(parseSave(file, level.id)).not.toBeNull();
  });
});

describe('settings (localStorage, separate from saves)', () => {
  it('falls back to defaults and persists changes', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
    };
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    saveSettings({ ...DEFAULT_SETTINGS, reducedMotion: true });
    expect(loadSettings().reducedMotion).toBe(true);
    store.set('skybound.settings.v1', '{broken');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
