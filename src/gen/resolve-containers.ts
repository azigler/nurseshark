// Walks Chemistry/ entity prototypes and pulls out the top-level container
// definitions (BaseBeaker, Jug, Bottle, Dropper, Vial, BluespaceBeaker, etc.).
// The pipeline does NOT try to resolve full component inheritance — it picks
// container volumes from the first SolutionContainerManager it sees on each
// entity and accepts that the values are the "configured" max.
import { join } from 'node:path';
import { findYamlFiles, readPrototypes } from './read-yaml';
import type { OutContainer, RawEntityPrototype } from './types';

// Entity IDs that represent user-facing containers (the ones the chemist
// actually hands out). Everything else under Chemistry/ is either abstract
// base/parent or pre-filled SKUs (JugDexPlusSaline etc.) which we skip.
const CONTAINER_WHITELIST = new Set([
  'Jug',
  'Beaker',
  'LargeBeaker',
  'CryostasisBeaker',
  'BluespaceBeaker',
  'BaseBeaker',
  'Dropper',
  'SyringeBase',
  'Syringe',
  'ChemBag',
  'Vial',
  'MiniVial',
  'Bottle',
]);

function maxVolFromComponents(
  components: RawEntityPrototype['components'] | undefined,
): { capacity: number | null; maxReagents: number | null } {
  if (!components) return { capacity: null, maxReagents: null };
  for (const c of components) {
    if (c.type !== 'SolutionContainerManager') continue;
    const solutions = (c as Record<string, unknown>).solutions;
    if (!solutions || typeof solutions !== 'object') continue;
    for (const sol of Object.values(solutions as Record<string, unknown>)) {
      if (!sol || typeof sol !== 'object') continue;
      const o = sol as Record<string, unknown>;
      const maxVol = typeof o.maxVol === 'number' ? o.maxVol : null;
      const maxReagents =
        typeof o.maxReagents === 'number' ? o.maxReagents : null;
      if (maxVol !== null) return { capacity: maxVol, maxReagents };
    }
  }
  return { capacity: null, maxReagents: null };
}

export function resolveContainers(vs14Path: string): readonly OutContainer[] {
  const entityDirs = [
    join(vs14Path, 'Resources/Prototypes/Entities/Objects/Specific/Chemistry'),
  ];
  const files: string[] = [];
  for (const d of entityDirs) {
    files.push(...findYamlFiles(d));
  }
  const raw = readPrototypes(files, [
    'entity',
  ]) as unknown as RawEntityPrototype[];

  const byId = new Map<string, RawEntityPrototype>();
  for (const e of raw) {
    if (e.id) byId.set(e.id, e);
  }

  const out: OutContainer[] = [];
  for (const id of CONTAINER_WHITELIST) {
    const e = byId.get(id);
    if (!e) continue;
    // Walk up the parent chain (shallow — one level) to pull capacity if
    // the leaf doesn't declare one.
    let capacity: number | null = null;
    let maxReagents: number | null = null;
    let cur: RawEntityPrototype | undefined = e;
    let hops = 0;
    while (cur && hops < 6) {
      const { capacity: cap, maxReagents: mr } = maxVolFromComponents(
        cur.components,
      );
      if (cap !== null && capacity === null) capacity = cap;
      if (mr !== null && maxReagents === null) maxReagents = mr;
      if (capacity !== null) break;
      const parent = cur.parent;
      const parentId = Array.isArray(parent) ? parent[0] : parent;
      if (typeof parentId !== 'string') break;
      cur = byId.get(parentId);
      hops++;
    }

    out.push({
      id: e.id,
      name: e.name ?? e.id,
      description: e.description ?? null,
      capacityU: capacity,
      maxReagents,
      spritesheetIndex: null,
    });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
