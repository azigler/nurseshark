// Walks the Reagents/ prototype folder and builds the reagents.json record.
// Extracts bloodstream metabolism rate + flattens HealthChange effects into
// the `heals` summary the solver uses. Abstract reagents are dropped.
import { join } from 'node:path';
import { findYamlFiles, readPrototypes } from './read-yaml';
import type {
  OutReagent,
  OutReagentConditionalHeal,
  OutReagentHealEntry,
  OutReagentSideEffect,
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

// ---------- Side-effect extraction ----------
//
// The pipeline was originally symmetric-biased: only NEGATIVE-delta damage
// entries were surfaced (as heals). Several reagents (Ultravasculine,
// Arithrazine, Dermaline over-OD) inflict positive-delta damage as a side
// cost. We also want to surface status-effect gates (Vomit, Jitter) so the
// UI can warn medics about thresholds. See vs-3il.5.

const STATUS_EFFECT_TYPES = new Set([
  'Vomit',
  'Jitter',
  'Drowsiness',
  'Drunk',
  'Stun',
  'SlurSpeech',
  'Emote',
]);

interface ReagentConditionGate {
  readonly reagentId: string | null;
  readonly min: number | null;
  readonly max: number | null;
}

interface ParsedConditions {
  readonly selfGate: ReagentConditionGate | null;
  readonly mobState: string | null;
  /** TotalDamageCondition max bound (Tricordrazine's <50 pattern). */
  readonly totalDamageMax: number | null;
  /** TotalDamageCondition min bound (reverse pattern, if it exists). */
  readonly totalDamageMin: number | null;
}

function parseConditions(effect: Tagged, reagentId: string): ParsedConditions {
  const conditions = effect.conditions;
  let selfGate: ReagentConditionGate | null = null;
  let mobState: string | null = null;
  let totalDamageMax: number | null = null;
  let totalDamageMin: number | null = null;
  if (!Array.isArray(conditions)) {
    return { selfGate, mobState, totalDamageMax, totalDamageMin };
  }
  for (const cond of conditions) {
    if (!cond || typeof cond !== 'object') continue;
    const c = cond as Record<string, unknown>;
    const type = c.__type;
    if (type === 'ReagentCondition' && c.reagent === reagentId) {
      const min = typeof c.min === 'number' ? c.min : null;
      const max = typeof c.max === 'number' ? c.max : null;
      selfGate = { reagentId, min, max };
    } else if (type === 'MobStateCondition') {
      if (typeof c.mobstate === 'string') mobState = c.mobstate;
    } else if (type === 'TotalDamageCondition') {
      if (typeof c.max === 'number') totalDamageMax = c.max;
      if (typeof c.min === 'number') totalDamageMin = c.min;
    }
  }
  return { selfGate, mobState, totalDamageMax, totalDamageMin };
}

function formatSelfGate(gate: ReagentConditionGate): string | null {
  if (gate.min !== null && gate.min > 0 && gate.max === null) {
    return `above ${gate.min}u`;
  }
  if (gate.max !== null && gate.min === null) {
    return `below ${gate.max}u`;
  }
  if (gate.min !== null && gate.max !== null) {
    return `${gate.min}u–${gate.max}u`;
  }
  return null;
}

function kindFor(
  target: string,
  shape: 'types' | 'groups' | 'flat',
): 'type' | 'group' {
  if (shape === 'groups') return 'group';
  if (shape === 'types') return 'type';
  return CANONICAL_GROUPS.has(target) ? 'group' : 'type';
}

function extractSideEffectsAndConditional(reagent: RawReagentPrototype): {
  sideEffects: OutReagentSideEffect[];
  conditionalHeals: OutReagentConditionalHeal[];
} {
  const bs = reagent.metabolisms?.Bloodstream;
  const sideEffects: OutReagentSideEffect[] = [];
  const conditionalHeals: OutReagentConditionalHeal[] = [];
  if (!bs?.effects || !reagent.id) {
    return { sideEffects, conditionalHeals };
  }

  for (const effect of bs.effects) {
    if (!effect || typeof effect !== 'object') continue;
    const e = effect as Tagged;
    const parsed = parseConditions(e, reagent.id);
    const selfGateLabel = parsed.selfGate
      ? formatSelfGate(parsed.selfGate)
      : null;

    // --- Status effects gated on self-concentration.
    if (STATUS_EFFECT_TYPES.has(e.__type)) {
      const amountRaw = e.probability ?? e.time ?? 1;
      const amount = typeof amountRaw === 'number' ? amountRaw : 1;
      const target = e.__type.toLowerCase();
      sideEffects.push({
        type: 'status',
        target,
        kind: 'status',
        amount,
        condition: selfGateLabel,
      });
      continue;
    }

    // --- HealthChange entries: split by sign and condition class.
    if (e.__type !== 'HealthChange' && e.__type !== 'EvenHealthChange') {
      continue;
    }
    const damage = e.damage as
      | { types?: Record<string, number>; groups?: Record<string, number> }
      | Record<string, number>
      | undefined;
    if (!damage || typeof damage !== 'object') continue;

    const iterDamage = (
      items: Record<string, number>,
      shape: 'types' | 'groups' | 'flat',
    ) => {
      for (const [target, v] of Object.entries(items)) {
        if (typeof v !== 'number') continue;
        const kind = kindFor(target, shape);
        if (v > 0) {
          // POSITIVE damage = side-effect (reagent hurts).
          sideEffects.push({
            type: 'damage',
            target,
            kind,
            amount: v,
            condition: selfGateLabel,
          });
        } else if (v < 0) {
          // NEGATIVE damage = heal. If gated on a patient-state condition we
          // can't verify at solve time (MobState, TotalDamage), capture it as
          // a conditional heal instead of folding into the flat `heals` list.
          const amountPerTick = Math.abs(v);
          if (parsed.mobState === 'Critical') {
            conditionalHeals.push({
              target,
              kind,
              amountPerTick,
              condition: 'patient must be in Critical state',
            });
          } else if (parsed.totalDamageMax !== null) {
            conditionalHeals.push({
              target,
              kind,
              amountPerTick,
              condition: `only when total damage < ${parsed.totalDamageMax}`,
            });
          } else if (parsed.totalDamageMin !== null) {
            conditionalHeals.push({
              target,
              kind,
              amountPerTick,
              condition: `only when total damage > ${parsed.totalDamageMin}`,
            });
          }
          // Non-patient-state heals (Alive-gate, self-concentration gate) are
          // handled by extractHeals above — no action here.
        }
      }
    };

    const types = (damage as { types?: Record<string, number> }).types;
    if (types && typeof types === 'object') {
      iterDamage(types, 'types');
    }
    const groups = (damage as { groups?: Record<string, number> }).groups;
    if (groups && typeof groups === 'object') {
      iterDamage(groups, 'groups');
    }
    if (!types && !groups) {
      // Shape 3 (EvenHealthChange flat form).
      iterDamage(damage as Record<string, number>, 'flat');
    }
  }

  return { sideEffects, conditionalHeals };
}

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
      ...extractSideEffectsAndConditional(r),
      effects: rawEffects,
      spritesheetIndex: null, // populated by spritesheet builder
    });
  }

  // Stable order by id.
  reagents.sort((a, b) => a.id.localeCompare(b.id));

  return { reagents, reagentEffectsById: effectsById };
}
