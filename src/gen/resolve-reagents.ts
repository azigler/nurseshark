// Walks the Reagents/ prototype folder and builds the reagents.json record.
// Extracts bloodstream metabolism rate + flattens HealthChange effects into
// the `heals` summary the solver uses. Abstract reagents are dropped.
import { join } from 'node:path';
import { findYamlFiles, readPrototypes } from './read-yaml';
import type {
  OutReagent,
  OutReagentHealEntry,
  RawReagentPrototype,
  Tagged,
} from './types';

const DEFAULT_METABOLISM_RATE = 0.5;

function extractHeals(reagent: RawReagentPrototype): OutReagentHealEntry[] {
  const bs = reagent.metabolisms?.Bloodstream;
  if (!bs?.effects) return [];

  const out: OutReagentHealEntry[] = [];
  for (const effect of bs.effects) {
    if (!effect || typeof effect !== 'object') continue;
    const e = effect as Tagged;
    if (e.__type !== 'HealthChange' && e.__type !== 'EvenHealthChange')
      continue;

    // We used to skip conditional effects here to filter out OD side-damage,
    // but many real heal effects gate on benign conditions like
    // `MobStateCondition: Alive`. Including all negative-delta effects
    // overcounts but is closer to the game's actual behavior than excluding
    // them. OD damage is ALWAYS positive-delta, so our >=0 filter below
    // handles it correctly.
    const damage = e.damage as
      | { types?: Record<string, number>; groups?: Record<string, number> }
      | Record<string, number>
      | undefined;
    if (!damage || typeof damage !== 'object') continue;

    // Shape 1: { damage: { types: { Blunt: -15 } } }
    const types = (damage as { types?: Record<string, number> }).types;
    if (types && typeof types === 'object') {
      for (const [k, v] of Object.entries(types)) {
        if (typeof v === 'number' && v < 0) {
          out.push({ target: k, kind: 'type', amountPerTick: Math.abs(v) });
        }
      }
    }

    // Shape 2: { damage: { groups: { Brute: -1.5 } } }
    const groups = (damage as { groups?: Record<string, number> }).groups;
    if (groups && typeof groups === 'object') {
      for (const [k, v] of Object.entries(groups)) {
        if (typeof v === 'number' && v < 0) {
          out.push({ target: k, kind: 'group', amountPerTick: Math.abs(v) });
        }
      }
    }

    // Shape 3 (EvenHealthChange common pattern): { damage: { Brute: -1.5 } }
    // — no `types`/`groups` wrapper, just raw key/number pairs.
    if (!types && !groups) {
      for (const [k, v] of Object.entries(damage)) {
        if (typeof v !== 'number' || v >= 0) continue;
        // Heuristic: well-known group IDs => group kind. We can't know without
        // the damage group/type tables, so caller reconciles via kind='group'
        // vs 'type' using damage.json. For now mark as 'group' if it's a
        // canonical group name, else 'type'. This is best-effort.
        const kind: 'type' | 'group' = CANONICAL_GROUPS.has(k)
          ? 'group'
          : 'type';
        out.push({ target: k, kind, amountPerTick: Math.abs(v) });
      }
    }
  }
  return out;
}

// Known damage-group IDs. Kept here to avoid a circular dep with resolve-damage
// at the cost of maintaining a small duplicate. Updated during resolve.
const CANONICAL_GROUPS = new Set([
  'Brute',
  'Burn',
  'Airloss',
  'Toxin',
  'Genetic',
  'Metaphysical',
]);

export interface ResolveReagentsResult {
  readonly reagents: readonly OutReagent[];
  /** Map from reagent ID → simplified display-ready effect list (for the frontend). */
  readonly reagentEffectsById: ReadonlyMap<string, readonly unknown[]>;
}

export function resolveReagents(vs14Path: string): ResolveReagentsResult {
  const reagentDir = join(vs14Path, 'Resources/Prototypes/Reagents');
  const files = findYamlFiles(reagentDir);
  const raw = readPrototypes(files, [
    'reagent',
  ]) as unknown as RawReagentPrototype[];

  const reagents: OutReagent[] = [];
  const effectsById = new Map<string, readonly unknown[]>();

  for (const r of raw) {
    if (r.abstract) continue;
    if (!r.id) continue;

    const bs = r.metabolisms?.Bloodstream;
    const rate =
      typeof bs?.metabolismRate === 'number'
        ? bs.metabolismRate
        : DEFAULT_METABOLISM_RATE;
    const rawEffects = (bs?.effects ?? []) as readonly unknown[];
    effectsById.set(r.id, rawEffects);

    reagents.push({
      id: r.id,
      name: r.name ?? r.id,
      desc: r.desc ?? null,
      physicalDesc: r.physicalDesc ?? null,
      color: r.color ?? null,
      group: r.group ?? null,
      metabolismRate: rate,
      conflictsWith: [], // populated by resolve-reactions razorium pass
      heals: extractHeals(r),
      effects: rawEffects,
      spritesheetIndex: null, // populated by spritesheet builder
    });
  }

  // Stable order by id.
  reagents.sort((a, b) => a.id.localeCompare(b.id));

  return { reagents, reagentEffectsById: effectsById };
}
