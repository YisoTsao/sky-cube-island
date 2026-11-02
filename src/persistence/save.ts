import type { GameState } from '../domain/types';
import { SaveFileSchema, type SaveFile } from '../domain/schemas';

export const GAME_VERSION = '0.1.0';
const DB_NAME = 'skybound';
const STORE = 'saves';
export const saveKey = (slot = 0) => `skybound.v2.save.${slot}`;
export const checkpointKey = (slot = 0) => `skybound.v2.checkpoint.${slot}`;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (!globalThis.indexedDB) return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function put(key: string, value: unknown): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
    } catch { resolve(false); }
  });
}

async function get(key: string): Promise<unknown> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); resolve(undefined); };
    } catch { resolve(undefined); }
  });
}

async function del(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    } catch { resolve(); }
  });
}

/** Only PREPARE / WAVE_RESULT are safe save points (Tech §11). */
export function isSafeSavePoint(s: GameState): boolean {
  return s.phase === 'PREPARE' || s.phase === 'WAVE_RESULT';
}

export function toSaveFile(state: GameState): SaveFile {
  return { saveVersion: 1, gameVersion: GAME_VERSION, savedAt: Date.now(), state: { ...state, enemies: [], spawnQueue: [] } as SaveFile['state'] };
}

export function parseSave(raw: unknown, levelId: string): GameState | null {
  const r = SaveFileSchema.safeParse(raw);
  if (!r.success || r.data.state.levelId !== levelId) return null;
  return r.data.state as GameState;
}

export async function writeSave(state: GameState, slot = 0): Promise<boolean> {
  if (!isSafeSavePoint(state)) return false;
  return put(saveKey(slot), toSaveFile(state));
}
export async function writeCheckpoint(state: GameState, slot = 0): Promise<boolean> {
  if (state.phase !== 'PREPARE') return false;
  return put(checkpointKey(slot), toSaveFile(state));
}
export async function readSave(levelId: string, slot = 0): Promise<GameState | null> { return parseSave(await get(saveKey(slot)), levelId); }
export async function readCheckpoint(levelId: string, slot = 0): Promise<GameState | null> { return parseSave(await get(checkpointKey(slot)), levelId); }
export async function clearSave(slot = 0): Promise<void> { await del(saveKey(slot)); await del(checkpointKey(slot)); }
