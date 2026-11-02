import type { LevelDef } from '../domain/types';
import { LevelDefSchema } from '../domain/schemas';
import { ENEMY_DEFS } from '../domain/definitions';
import { indexLevel, posKey } from '../navigation/derived-map';
import { computeRoutes } from '../navigation/connectivity';

export interface LevelValidationResult { ok: boolean; errors: string[] }

/** Level Schema validation (Tech §3.3) — must pass before a level is playable. */
export function validateLevel(level: LevelDef): LevelValidationResult {
  const errors: string[] = [];
  const parsed = LevelDefSchema.safeParse(level);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `schema: ${i.path.join('.')} ${i.message}`) };
  }

  // 1–2. bounds, unique ids, no overlapping surfaces at same x/z (MVP).
  const ids = new Set<string>();
  const pos = new Set<string>();
  for (const c of level.cells) {
    if (c.pos.x < 0 || c.pos.z < 0 || c.pos.x >= level.width || c.pos.z >= level.depth) errors.push(`cell ${c.id} out of bounds`);
    if (ids.has(c.id)) errors.push(`duplicate cellId ${c.id}`);
    ids.add(c.id);
    const k = posKey(c.pos.x, c.pos.z);
    if (pos.has(k)) errors.push(`overlapping surfaces at ${k} are not supported in MVP`);
    pos.add(k);
  }
  const idx = indexLevel(level);
  const cell = (id: string) => idx.cells.get(id);

  // 3. platforms
  const seen = new Set<string>();
  for (const p of level.platforms) {
    for (const id of p.cellIds) {
      const c = cell(id);
      if (!c) { errors.push(`platform ${p.id} references missing ${id}`); continue; }
      if (seen.has(id)) errors.push(`cell ${id} listed in multiple platforms`);
      seen.add(id);
      if (c.platformId !== p.id) errors.push(`cell ${id} platformId mismatch (${c.platformId} vs ${p.id})`);
    }
  }

  // 4–5. connectors
  for (const con of level.connectors) {
    if (con.chain.length < 2) { errors.push(`connector ${con.id} chain too short`); continue; }
    const nodes = con.chain.map(cell);
    if (nodes.some((n) => !n)) { errors.push(`connector ${con.id} references missing cell`); continue; }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (first.kind !== 'ground' || last.kind !== 'ground') errors.push(`connector ${con.id} endpoints must be ground`);
    if (first.platformId === last.platformId) errors.push(`connector ${con.id} endpoints must be on different platforms`);
    for (let i = 1; i < nodes.length - 1; i++) {
      const n = nodes[i]!;
      if (n.kind === 'ground') errors.push(`connector ${con.id} intermediate ${n.id} must be a deck`);
      if (n.editable || n.buildable) errors.push(`connector deck ${n.id} must not be editable/buildable`);
    }
    for (let i = 0; i + 1 < nodes.length; i++) {
      const a = nodes[i]!;
      const b = nodes[i + 1]!;
      if (Math.abs(a.pos.x - b.pos.x) + Math.abs(a.pos.z - b.pos.z) !== 1) errors.push(`connector ${con.id} step ${a.id}->${b.id} not 4-adjacent`);
      if (Math.abs(a.elevation - b.elevation) > 1) errors.push(`connector ${con.id} step ${a.id}->${b.id} height jump > 1`);
    }
    for (const n of [first, last]) {
      if (n.editable) errors.push(`connector endpoint ${n.id} must not be editable`);
      if (n.buildable) errors.push(`connector endpoint ${n.id} must not be buildable`);
    }
  }

  // 6. portals
  if (level.portals.length < 2) errors.push('need at least 2 portals');
  const portalCells = new Set<string>();
  for (const p of level.portals) {
    const c = cell(p.cellId);
    if (!c) { errors.push(`portal ${p.id} missing cell`); continue; }
    if (portalCells.has(p.cellId)) errors.push(`portal ${p.id} duplicates another portal cell`);
    portalCells.add(p.cellId);
    if (c.kind !== 'ground') errors.push(`portal ${p.id} must be on ground`);
    if (c.editable || c.buildable) errors.push(`portal ${p.id} cell must not be editable/buildable`);
  }

  // 7. core
  const fp = level.core.footprintCellIds.map(cell);
  if (fp.length !== 9 || fp.some((c) => !c) || new Set(level.core.footprintCellIds).size !== 9) {
    errors.push('core footprint must be exactly 9 distinct cells');
  } else {
    const xs = fp.map((c) => c!.pos.x);
    const zs = fp.map((c) => c!.pos.z);
    const minX = Math.min(...xs); const minZ = Math.min(...zs);
    const square = fp.every((c) => c!.pos.x - minX < 3 && c!.pos.z - minZ < 3);
    const samePlat = fp.every((c) => c!.platformId === fp[0]!.platformId && c!.elevation === fp[0]!.elevation);
    if (!square || !samePlat) errors.push('core footprint must be a 3x3 square on one platform/elevation');
    if (fp.some((c) => c!.editable || c!.buildable)) errors.push('core footprint must not be editable/buildable');
    if (level.core.approachNodeIds.length < 2) errors.push('core needs at least 2 approach nodes');
    const fpSet = new Set(level.core.footprintCellIds);
    for (const aid of level.core.approachNodeIds) {
      const a = cell(aid);
      if (!a) { errors.push(`approach ${aid} missing`); continue; }
      if (fpSet.has(aid)) errors.push(`approach ${aid} overlaps core`);
      if (a.kind !== 'ground') errors.push(`approach ${aid} must be ground`);
      if (a.editable || a.buildable) errors.push(`approach ${aid} must be protected`);
      const adjacent = fp.some((c) => Math.abs(c!.pos.x - a.pos.x) + Math.abs(c!.pos.z - a.pos.z) === 1);
      if (!adjacent) errors.push(`approach ${aid} is not orthogonally adjacent to the core`);
    }
  }

  // 9. flag combos
  for (const c of level.cells) {
    if (c.editable && c.kind !== 'ground') errors.push(`${c.id}: only ground can be editable`);
    if (c.editable && c.immutable) errors.push(`${c.id}: editable and immutable conflict`);
    if (c.buildable && c.kind !== 'ground') errors.push(`${c.id}: only ground can be buildable`);
  }

  // 10. waves
  const portalIds = new Set(level.portals.map((p) => p.id));
  for (const w of level.waves) {
    for (const e of w.entries) {
      if (!ENEMY_DEFS[e.enemyKind]) errors.push(`wave ${w.id}: unknown enemy ${e.enemyKind}`);
      for (const pid of e.portalIds) if (!portalIds.has(pid)) errors.push(`wave ${w.id}: unknown portal ${pid}`);
    }
  }

  // 8. initial routes
  if (!errors.length) {
    const routes = computeRoutes(level, { editedElevations: {}, towers: [], walls: [] });
    if (!routes.ok) errors.push(`initial route check failed: ${routes.code} at portal ${routes.portalId}`);
  }
  return { ok: errors.length === 0, errors };
}
