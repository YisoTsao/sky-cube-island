import type { CommandResult, GameCommand, GameState, LevelDef } from '../domain/types';
import { ECONOMY } from '../domain/definitions';
import { executeCommand, rejectionMessage } from '../commands/execute';

/** PREPARE undo stack (Tech §6.4, D21-06) — session memory only, never serialised. */
export interface PrepareSession { history: GameState[] }

export const createSession = (): PrepareSession => ({ history: [] });

export function dispatch(level: LevelDef, session: PrepareSession, state: GameState, cmd: GameCommand): CommandResult {
  if (cmd.type === 'UNDO_PREPARE') {
    if (state.phase !== 'PREPARE') return { ok: false, state, code: 'INVALID_PHASE', message: rejectionMessage('INVALID_PHASE') };
    const prev = session.history.pop();
    if (!prev) return { ok: false, state, code: 'NOTHING_TO_UNDO', message: rejectionMessage('NOTHING_TO_UNDO') };
    return {
      ok: true, state: prev, cost: prev.gold - state.gold,
      events: [
        { type: 'UNDO_APPLIED', tick: prev.tick },
        { type: 'GOLD_CHANGED', tick: prev.tick, delta: prev.gold - state.gold, balance: prev.gold, reason: 'undo' },
        { type: 'ROUTES_CHANGED', tick: prev.tick, portalIds: level.portals.map((p) => p.id) },
      ],
    };
  }
  const result = executeCommand(level, state, cmd);
  if (result.ok && state.phase === 'PREPARE' && cmd.type !== 'START_WAVE') {
    session.history.push(state);
    if (session.history.length > ECONOMY.maxUndo) session.history.shift();
  }
  if (result.ok && (cmd.type === 'START_WAVE' || result.state.phase !== 'PREPARE')) session.history = [];
  return result;
}
