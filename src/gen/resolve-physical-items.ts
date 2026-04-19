// Parses physical medical items (Bandage, Gauze, Ointment, Regenerative
// Mesh, Medicated Suture, Blood Pack, Tourniquet, etc.) out of the VS14
// YAML at `Resources/Prototypes/Entities/Objects/Specific/Medical/healing.yml`.
//
// The solver uses this to recommend physical items alongside the chem mix.
// Before this resolver existed, `src/data/physical-items.ts` hand-modeled the
// heal amounts; vs-3il.2 replaces that with verified numbers + drift-check
// via the `sourcePrototypeFile` trail.
//
// Key mechanics captured from `Content.Shared/Medical/Healing/HealingComponent.cs`:
//
//   - `damage.types` → per-type delta. Negative = heal, positive = penalty
//     (e.g. Tourniquet inflicts Blunt +5 Asphyxiation +5 in exchange for
//     stopping bleeding). Absolute values stored in `healsPerApplication`
//     or `damagePenalty` based on sign.
//   - `bloodlossModifier` (float) → slows active bleeding. NOT the same as
//     healing Bloodloss damage; SS14 treats these as distinct. Negative
//     value = bleeding slowed.
//   - `modifyBloodLevel` (float) → directly raises the patient's blood pool
//     via `TryModifyBloodLevel`, operating on the species-agnostic
//     `BloodstreamComponent`. This is NOT iron-metabolism-gated (see
//     `SharedBloodstreamSystem.TryModifyBloodLevel`: it just regulates the
//     blood solution volume; all humanoid species have a Bloodstream).
//
// Entities are picked up when they:
//   - declare a `- type: Healing` component, AND
//   - are NOT abstract.
//
// The resolver walks the single `healing.yml` file; if/when VS14 adds more
// healing items in sibling files, extend `MEDICAL_DIR` glob usage.

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findYamlFiles, readPrototypes } from './read-yaml';
import type {
  OutPhysicalItem,
  RawEntityPrototype,
  RawHealingComponent,
  RawStackComponent,
} from './types';

const MEDICAL_DIR = 'Resources/Prototypes/Entities/Objects/Specific/Medical';

/**
 * Entity IDs we explicitly surface to the solver. VS14 has many entities with
 * a Healing component (the `HealingToolbox` is an admin-only cheat item, for
 * example). We whitelist the legit field-medic kit items.
 *
 * Single-use variants (Ointment1, Gauze1, etc.) are parented to the full-stack
 * prototype and inherit the Healing component — we skip them so the list
 * stays clean (solver already scales by stack size separately).
 */
const PHYSICAL_ITEM_WHITELIST: ReadonlySet<string> = new Set([
  'Ointment',
  'RegenerativeMesh',
  'Brutepack',
  'MedicatedSuture',
  'Bloodpack',
  'Gauze',
  'Tourniquet',
  'AloeCream',
]);

function findComponent<T>(
  components: RawEntityPrototype['components'],
  componentType: string,
): T | undefined {
  if (!components) return undefined;
  for (const c of components) {
    if (c.type === componentType) return c as unknown as T;
  }
  return undefined;
}

/**
 * Walk the parent chain collecting (entity, sourceFile) pairs so the resolver
 * can pull components inherited from a `BaseHealingItem` / `Ointment` parent.
 */
function resolveInherited(
  entity: RawEntityPrototype,
  byId: ReadonlyMap<string, RawEntityPrototype>,
): RawEntityPrototype[] {
  const chain: RawEntityPrototype[] = [entity];
  let cur: RawEntityPrototype | undefined = entity;
  let hops = 0;
  while (cur && hops < 6) {
    const parentRef = cur.parent;
    const parentId = Array.isArray(parentRef) ? parentRef[0] : parentRef;
    if (typeof parentId !== 'string') break;
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.push(parent);
    cur = parent;
    hops += 1;
  }
  return chain;
}

function prettify(id: string): string {
  // "MedicatedSuture" -> "Medicated Suture"; "Bloodpack" -> "Bloodpack"
  return id.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function resolvePhysicalItems(
  vs14Path: string,
): readonly OutPhysicalItem[] {
  const files = findYamlFiles(join(vs14Path, MEDICAL_DIR));
  const raw = readPrototypes(files, [
    'entity',
  ]) as unknown as RawEntityPrototype[];

  // Remember which file each entity was parsed from so we can emit an audit
  // trail. readPrototypes strips that context, so do a cheap second pass.
  const fileForEntity = new Map<string, string>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // Match `id: Foo` lines at an acceptable indent (top-level entity block).
    for (const m of src.matchAll(/^\s+id:\s*([A-Za-z0-9_]+)\s*$/gm)) {
      const id = m[1];
      if (!fileForEntity.has(id)) {
        fileForEntity.set(id, relative(vs14Path, f));
      }
    }
  }

  const byId = new Map<string, RawEntityPrototype>();
  for (const e of raw) {
    if (e.id) byId.set(e.id, e);
  }

  const out: OutPhysicalItem[] = [];
  for (const entity of raw) {
    if (!entity.id || entity.abstract) continue;
    if (!PHYSICAL_ITEM_WHITELIST.has(entity.id)) continue;

    const chain = resolveInherited(entity, byId);

    // Pull the Healing + Stack components from the nearest ancestor that
    // declares them. SS14 inheritance is shallow-override: a child overrides
    // fields in its parent's component of the same type, but we only use the
    // leaf's values here (YAML inheritance resolution at full fidelity is its
    // own can of worms, and the whitelist'd items all declare Healing locally).
    let healing: RawHealingComponent | undefined;
    let stack: RawStackComponent | undefined;
    for (const e of chain) {
      if (!healing) {
        healing = findComponent<RawHealingComponent>(e.components, 'Healing');
      }
      if (!stack) {
        stack = findComponent<RawStackComponent>(e.components, 'Stack');
      }
      if (healing && stack) break;
    }

    if (!healing) {
      // No Healing component anywhere in the chain → not a healing item.
      continue;
    }

    const heals: Record<string, number> = {};
    const penalty: Record<string, number> = {};
    const types = healing.damage?.types ?? {};
    for (const [k, v] of Object.entries(types)) {
      if (typeof v !== 'number') continue;
      if (v < 0) {
        heals[k] = Math.abs(v);
      } else if (v > 0) {
        penalty[k] = v;
      }
    }

    // Use the entity's name field if set; fall back to prettified id.
    const name = entity.name?.trim() || prettify(entity.id);
    const sourceFile =
      fileForEntity.get(entity.id) ?? `${MEDICAL_DIR}/healing.yml`;

    out.push({
      id: entity.id,
      name,
      description: entity.description ?? null,
      healsPerApplication: heals,
      damagePenalty: penalty,
      bloodlossModifier: healing.bloodlossModifier ?? 0,
      modifyBloodLevel: healing.modifyBloodLevel ?? 0,
      stackSize: stack?.count ?? 1,
      // VS14's HealingSystem uses TryChangeDamage (species-agnostic within
      // Biological damageContainer) and TryModifyBloodLevel (species-agnostic
      // via BloodstreamComponent). None of the current healing items gate
      // on species, so all default to false. If a future item adds a
      // Healing extension with species gating, set this flag to true here.
      ironMetabolism: false,
      sourcePrototypeFile: sourceFile,
    });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
