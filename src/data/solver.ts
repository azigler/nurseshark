// Damage-driven solver — turns a health-scanner readout (damage per type +
// species + filter toggles) into a full-heal recipe (chem mix, physical
// items, cryo flow, warnings, estimated time).
//
// Algorithm sketch (greedy, not LP):
//
//   1. Collect per-type healer candidates from the reagent data. A reagent
//      is a candidate for damage type D if any of its heals[] entries covers
//      D directly (kind: "type") or via a damage group that includes D.
//   2. Rank candidates for each non-zero damage type by:
//        a) coverage of the INPUT damage profile (how many other non-zero
//           damage types does this reagent also cover?)
//        b) effective heal rate (amountPerTick per reagent unit, scaled by
//           metabolismRate ticks)
//        c) lower conflict risk (fewer razorium entries)
//   3. Assemble the mix: walk damage types in priority order (Bloodloss
//      first for species overlay, then by descending damage amount). For
//      each type pick the top-ranked candidate, add its dose, mark all
//      other damage types that candidate covers as "partially served" so
//      we don't double-pick. Dedupe across types.
//   4. Compute per-reagent dose:
//        dose_units = ceil(damage_remaining / (amountPerTick * ticks_per_unit))
//      Capped at the reagent's OD threshold (effects with ReagentCondition
//      min targeting itself = OD; the smallest such min is the cap).
//   5. Razorium: if two picked reagents list each other in conflictsWith,
//      keep the one with higher total coverage and emit a warning.
//   6. Species overlay: Moth/Vox/Diona + Bloodloss > 0 + picked reagent is
//      iron-metabolism → swap to Saline (universal blood restorer).
//   7. Cryo fallback: if damage exceeds best single-shot coverage and the
//      Cryo filter is on, route the excess to cryo (Cryoxadone for multi-
//      damage, Aloxadone for heat-focused, Opporozidone for rotting/cellular,
//      Doxarubixadone for pure-cellular). Temperature target: Cryoxadone 213K
//      (cold tube range), others at 150K (deep cryo) for specialized chems.
//   8. Physical items (Bandage, Gauze, Ointment, Regenerative Mesh,
//      Medicated Sutures, Blood Pack) come from a static list in
//      physical-items.ts — they're not in the game's reagent pipeline. Only
//      included when the Physical filter is on.
//
// Explainability: every output entry carries a `reason` string so new
// medics learn what each line does and veterans can spot-check.

import { buildLabel } from '../components/CopyLabelButton';
import type {
  DamageProfile,
  DamageTypeId,
  PhysicalItem,
  Reagent,
  SolverCryoEntry,
  SolverIngredient,
  SolverInput,
  SolverOutput,
  SolverPhysicalEntry,
} from '../types';
import { prettifyId, resolveFluentKey } from './fluent';
import { blacklistEntry, isBlacklisted } from './reagent-blacklist';
import type { DataBundle } from './store';

// ---------- Constants ----------

const TREATABLE_DAMAGE_TYPES: readonly DamageTypeId[] = [
  'Blunt',
  'Piercing',
  'Slash',
  'Heat',
  'Cold',
  'Shock',
  'Poison',
  'Caustic',
  'Cellular',
  'Radiation',
  'Bloodloss',
  'Asphyxiation',
];

/** Species whose blood CANNOT be metabolised from Iron — they need Saline. */
const NON_IRON_METABOLISM_SPECIES: ReadonlySet<string> = new Set([
  'Moth',
  'Vox',
  'Diona',
  'SlimePerson',
  'Arachnid',
]);

/**
 * Arachnids are a special case within the non-iron-metabolism cohort:
 * Iron is actively TOXIC to them (confirmed in-game — see
 * `Resources/Prototypes/Reagents/elements.yml`: Iron's `HealthChange`
 * is gated on `MetabolizerTypeCondition { type: [Arachnid] }` and
 * delivers Poison 0.1/tick, while its `ModifyBloodLevel` is gated on
 * `inverted: true` so no blood is restored). Copper is the mirror:
 * `ModifyBloodLevel` fires FOR Arachnids and Poison HealthChange is
 * inverted.
 *
 * Wiki phrasing (Guide_to_Medical): "If the patient is an arachnid,
 * note that Iron is toxic to them. Use Copper instead, which will
 * provide the same effect to them."
 *
 * Consequently, for Arachnid bloodloss the preferred overlay is Copper
 * (the species-correct blood restorer) rather than Saline. Saline is
 * the fallback when Copper is blacklisted/unavailable.
 */
const ARACHNID_BLOOD_RESTORER = 'Copper';

/**
 * Copper's ModifyBloodLevel delivers 0.4 per tick at metabolismRate 0.1,
 * so one unit sustains 10 ticks → 4 Bloodloss healed per unit. Mirrors
 * the Saline math below. (Source of truth is still the YAML — this is a
 * hard-coded constant for overlay estimation because ModifyBloodLevel
 * amounts aren't surfaced via the heals[] model.)
 */
const COPPER_HEAL_PER_UNIT = 4;

/**
 * Saline's ModifyBloodLevel: amount 6 per tick, no metabolism gate →
 * heal-per-unit used when the overlay injects Saline.
 */
const SALINE_HEAL_PER_UNIT = 6;

/**
 * Reagents that restore Blood level via iron-metabolism. These should be
 * swapped for Saline for Moth/Vox/Diona/Slime/Arachnid patients. Empirically
 * derived from the pipeline: reagents with a `ModifyBloodLevel` effect that
 * aren't Saline (species-agnostic) or Ichor (biological magic).
 *
 * Since the solver never picks Iron/Copper directly (no `heals[]` entries
 * for Bloodloss), the main "iron-chain" picks are DexalinPlus, Dexalin, and
 * Ichor. Ichor is tree-sap / biological and explicitly works on Diona, so
 * we DON'T swap it out for Diona — just for Moth/Vox/Arachnid/Slime where
 * Ichor is also odd. Keep this simple: swap any bloodloss healer not in
 * the universal allowlist below.
 */
const UNIVERSAL_BLOOD_RESTORERS: ReadonlySet<string> = new Set(['Saline']);

/** Brute razorium cluster — only one allowed in a mix. */
const BRUTE_MEDS: ReadonlySet<string> = new Set([
  'Bicaridine',
  'Bruizine',
  'Lacerinol',
  'Puncturase',
]);

/**
 * Seconds per tick — SS14 reagent metabolism updates once per second on
 * average. A reagent consumes `metabolismRate` units per tick, so one unit
 * of a 0.5-rate reagent lasts 2 ticks.
 */
const TICK_SECONDS = 1;

/** Priority order for picking damage types first (bloodloss first for overlay). */
const PICK_ORDER: readonly DamageTypeId[] = [
  'Bloodloss',
  'Asphyxiation',
  'Cellular',
  'Radiation',
  'Caustic',
  'Poison',
  'Heat',
  'Cold',
  'Shock',
  'Blunt',
  'Piercing',
  'Slash',
];

// ---------- OD thresholds ----------

/**
 * Extract the OD threshold for a reagent. Defined as the lowest `min`
 * value on any negative effect (Vomit, Jitter, extra damage etc.) gated by
 * a ReagentCondition targeting itself. If no such gate exists, return
 * Infinity (unbounded within reasonable mix sizes).
 */
export function odThresholdFor(reagent: Reagent): number {
  let min = Number.POSITIVE_INFINITY;
  for (const eff of reagent.effects ?? []) {
    if (!eff || typeof eff !== 'object') continue;
    const effObj = eff as Record<string, unknown>;
    const conditions = effObj.conditions;
    if (!Array.isArray(conditions)) continue;
    for (const cond of conditions) {
      if (!cond || typeof cond !== 'object') continue;
      const c = cond as Record<string, unknown>;
      if (c.__type === 'ReagentCondition' && c.reagent === reagent.id) {
        const m = c.min;
        if (typeof m === 'number' && m > 0 && m < min) {
          min = m;
        }
      }
    }
  }
  return min;
}

// ---------- Candidate scoring ----------

interface Candidate {
  readonly reagent: Reagent;
  /** Per-type amount healed per unit, per second. */
  readonly ratePerUnitPerSec: number;
  /** Set of damage types this candidate covers (expanded from groups). */
  readonly covers: ReadonlySet<DamageTypeId>;
  /** Count of input-profile damage types this candidate covers. */
  readonly profileCoverage: number;
  /** OD threshold cap. */
  readonly odCap: number;
}

function damageTypeIsTreatable(t: string): t is DamageTypeId {
  return (TREATABLE_DAMAGE_TYPES as readonly string[]).includes(t);
}

function reagentCoversTypes(
  reagent: Reagent,
  data: DataBundle,
): Set<DamageTypeId> {
  const out = new Set<DamageTypeId>();
  for (const h of reagent.heals) {
    if (h.amountPerTick <= 0) continue;
    if (h.kind === 'type') {
      if (damageTypeIsTreatable(h.target)) out.add(h.target);
    } else {
      const members = data.damageGroupMembers.get(h.target);
      if (members) {
        for (const m of members) {
          if (damageTypeIsTreatable(m)) out.add(m);
        }
      }
    }
  }
  return out;
}

function healRateForType(
  reagent: Reagent,
  type: DamageTypeId,
  data: DataBundle,
): number {
  let best = 0;
  for (const h of reagent.heals) {
    if (h.amountPerTick <= 0) continue;
    if (h.kind === 'type') {
      if (h.target === type && h.amountPerTick > best) best = h.amountPerTick;
    } else {
      const members = data.damageGroupMembers.get(h.target);
      if (members?.includes(type) && h.amountPerTick > best) {
        best = h.amountPerTick;
      }
    }
  }
  return best;
}

/** Build candidate list for a single damage type, ranked best-first. */
function candidatesFor(
  type: DamageTypeId,
  damage: DamageProfile,
  data: DataBundle,
  includeRestricted: boolean,
): Candidate[] {
  const nonZeroInput = new Set<DamageTypeId>(
    (Object.keys(damage) as DamageTypeId[]).filter((k) => (damage[k] ?? 0) > 0),
  );

  const candidates: Candidate[] = [];
  for (const r of data.reagents) {
    const rateType = healRateForType(r, type, data);
    if (rateType <= 0) continue;
    // Blacklist filter: skip uncraftable / admin-spawn reagents unless the
    // caller explicitly opts in via includeRestricted. Species-overlay
    // special-cases (e.g. Ichor for Diona) are handled downstream — the
    // overlay reads the ingredient list directly and doesn't go through
    // this ranking path.
    if (!includeRestricted && isBlacklisted(r.id)) continue;
    const covers = reagentCoversTypes(r, data);
    // How much of the INPUT profile does this reagent cover?
    let profileCoverage = 0;
    for (const t of covers) if (nonZeroInput.has(t)) profileCoverage += 1;
    const odCap = odThresholdFor(r);
    // rate per unit per sec: amountPerTick * metabolismRate (units/tick) gives
    // damage healed per second per unit of reagent in body.
    const ratePerUnitPerSec = rateType * r.metabolismRate;
    candidates.push({
      reagent: r,
      ratePerUnitPerSec,
      covers,
      profileCoverage,
      odCap,
    });
  }

  candidates.sort((a, b) => {
    // 1. Higher profile coverage first.
    if (b.profileCoverage !== a.profileCoverage) {
      return b.profileCoverage - a.profileCoverage;
    }
    // 2. Higher effective rate.
    if (b.ratePerUnitPerSec !== a.ratePerUnitPerSec) {
      return b.ratePerUnitPerSec - a.ratePerUnitPerSec;
    }
    // 3. Higher OD cap (more headroom, lower risk).
    if (b.odCap !== a.odCap) {
      return b.odCap - a.odCap;
    }
    // 4. Fewer conflicts.
    return a.reagent.conflictsWith.length - b.reagent.conflictsWith.length;
  });

  return candidates;
}

// ---------- Dose computation ----------

/**
 * Practical single-reagent cap when no OD gate exists. Matches the ~50u
 * capacity of a standard hypopen / small beaker — beyond this the medic
 * should split the dose or route excess to cryo.
 */
const PRACTICAL_SINGLE_REAGENT_CAP = 50;

function computeDose(cand: Candidate, damageAmount: number): number {
  if (cand.ratePerUnitPerSec <= 0 || damageAmount <= 0) return 0;
  // metabolismRate is units-consumed-per-tick. Each tick heals amountPerTick
  // (regardless of units above 0). So 1u lasts 1/metabolismRate ticks and
  // delivers amountPerTick/metabolismRate total heal for its damage type.
  const rateType = cand.ratePerUnitPerSec / cand.reagent.metabolismRate;
  const healPerUnit = rateType / cand.reagent.metabolismRate;
  const needed = Math.ceil(damageAmount / healPerUnit);
  // Enforce a minimum effective dose (5u) and the OD cap.
  const minDose = 5;
  const dose = Math.max(minDose, needed);
  if (Number.isFinite(cand.odCap)) {
    return Math.min(dose, Math.floor(cand.odCap));
  }
  // No OD gate in the data → still cap at a practical mix-size limit so the
  // solver surfaces "needs more than one dose" when damage is extreme.
  return Math.min(dose, PRACTICAL_SINGLE_REAGENT_CAP);
}

/** Effective damage an OD-capped dose can actually heal. */
function effectiveHealForDose(
  cand: Candidate,
  units: number,
  type: DamageTypeId,
  data: DataBundle,
): number {
  const rate = healRateForType(cand.reagent, type, data);
  if (rate <= 0) return 0;
  const healPerUnit = rate / cand.reagent.metabolismRate;
  return healPerUnit * units;
}

// ---------- Species overlay ----------

function applySpeciesOverlay(
  ingredients: SolverIngredient[],
  input: SolverInput,
  data: DataBundle,
  remainingBloodloss: number,
): { ingredients: SolverIngredient[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!NON_IRON_METABOLISM_SPECIES.has(input.species)) {
    return { ingredients, warnings };
  }
  // Only care about Bloodloss that WASN'T handled by physical items.
  const bloodloss = Math.max(0, remainingBloodloss);
  if (bloodloss <= 0) {
    return { ingredients, warnings };
  }

  // The spec's "iron-metabolism swap" is about ensuring a species-appropriate
  // blood restorer is present for Moth/Vox/Diona/Slime/Arachnid when there's
  // Bloodloss. In the current game data, only the raw `Iron` and `Copper`
  // reagents are strictly species-gated (and the solver never picks them
  // directly because neither has a `heals[]` entry — their blood effect is a
  // `ModifyBloodLevel`, not a `HealthChange`). So the pragmatic behavior:
  // drop any non-universal bloodloss healer that doesn't also cover other
  // input damage types, and ensure the species-appropriate restorer is
  // present.
  //
  // Species priority:
  //   - Diona: Ichor (tree-sap) is compatible; keep it if present, else Saline.
  //   - Arachnid: Copper (species-gated blood restorer in-game) is preferred
  //     over Saline; Iron is TOXIC (applies Poison 0.1/tick). Fall back to
  //     Saline only if Copper is blacklisted/unavailable.
  //   - Moth/Vox/SlimePerson: Saline (universal).
  const out: SolverIngredient[] = [];
  const nonZeroInputTypes = new Set(
    (Object.keys(input.damage) as DamageTypeId[]).filter(
      (k) => (input.damage[k] ?? 0) > 0,
    ),
  );
  const dionaIchorOk = input.species === 'Diona';
  const isArachnid = input.species === 'Arachnid';
  for (const ing of ingredients) {
    const r = data.reagentsById.get(ing.reagentId);
    if (!r) {
      out.push(ing);
      continue;
    }
    const coversBloodloss = healRateForType(r, 'Bloodloss', data) > 0;
    if (!coversBloodloss || UNIVERSAL_BLOOD_RESTORERS.has(r.id)) {
      out.push(ing);
      continue;
    }
    // Diona: tree-sap compatible with Ichor.
    if (dionaIchorOk && r.id === 'Ichor') {
      out.push(ing);
      continue;
    }
    // Does this reagent cover any OTHER input damage types beyond Bloodloss?
    const covers = reagentCoversTypes(r, data);
    const otherInputCoverage = [...covers].some(
      (t) => t !== 'Bloodloss' && nonZeroInputTypes.has(t),
    );
    if (otherInputCoverage) {
      // Keep for non-blood coverage; species-appropriate restorer added below.
      out.push(ing);
    } else {
      // Drop — this reagent was picked only for Bloodloss and isn't safe for
      // this species. Warning phrasing mirrors the wiki for Arachnid.
      if (isArachnid) {
        warnings.push(
          `Arachnid: ${r.id} dropped — Iron is toxic to Arachnids. Using Copper instead.`,
        );
      } else {
        warnings.push(
          `${input.species}: ${r.id} swapped for Saline (iron-metabolism blood not compatible).`,
        );
      }
    }
  }

  // Ensure the species-appropriate restorer is present.
  const hasDionaIchor =
    dionaIchorOk && out.some((ing) => ing.reagentId === 'Ichor');
  const hasSaline = out.some((ing) => ing.reagentId === 'Saline');
  const hasCopper = out.some(
    (ing) => ing.reagentId === ARACHNID_BLOOD_RESTORER,
  );

  if (isArachnid && !hasCopper && !hasSaline) {
    // Copper is the species-correct pick for Arachnid. If it's blacklisted or
    // otherwise unavailable, fall back to Saline with a stronger warning —
    // either way the patient gets a non-toxic blood restorer.
    const copperAvailable =
      data.reagentsById.has(ARACHNID_BLOOD_RESTORER) &&
      !isBlacklisted(ARACHNID_BLOOD_RESTORER);
    if (copperAvailable) {
      const needed = Math.max(5, Math.ceil(bloodloss / COPPER_HEAL_PER_UNIT));
      out.push({
        reagentId: ARACHNID_BLOOD_RESTORER,
        units: needed,
        reason: `Copper × ${needed}u — covers ${bloodloss} Bloodloss for Arachnid (Iron is toxic; Copper is the species-gated blood restorer).`,
      });
    } else {
      const needed = Math.max(5, Math.ceil(bloodloss / SALINE_HEAL_PER_UNIT));
      out.push({
        reagentId: 'Saline',
        units: needed,
        reason: `Saline × ${needed}u — covers ${bloodloss} Bloodloss for Arachnid (Copper unavailable; Iron is toxic to Arachnids).`,
      });
      warnings.push(
        'Arachnid: Copper unavailable — falling back to Saline. Iron is toxic to Arachnids; do not substitute.',
      );
    }
  } else if (!isArachnid && !hasSaline && !hasDionaIchor) {
    const needed = Math.max(5, Math.ceil(bloodloss / SALINE_HEAL_PER_UNIT));
    out.push({
      reagentId: 'Saline',
      units: needed,
      reason: `Saline × ${needed}u — covers ${bloodloss} Bloodloss for ${input.species} (universal restorer; iron-metabolism safe).`,
    });
  }
  return { ingredients: out, warnings };
}

// ---------- Razorium check ----------

function enforceRazorium(
  ingredients: SolverIngredient[],
  data: DataBundle,
): { ingredients: SolverIngredient[]; warnings: string[] } {
  const warnings: string[] = [];
  const byId = new Map(ingredients.map((i) => [i.reagentId, i]));
  // Pairwise: if two picked reagents list each other in conflictsWith, drop
  // the one with lower total coverage.
  const toDrop = new Set<string>();
  const picked = [...byId.keys()];
  for (let i = 0; i < picked.length; i += 1) {
    for (let j = i + 1; j < picked.length; j += 1) {
      const a = picked[i];
      const b = picked[j];
      if (toDrop.has(a) || toDrop.has(b)) continue;
      const ra = data.reagentsById.get(a);
      const rb = data.reagentsById.get(b);
      if (!ra || !rb) continue;
      const conflict =
        ra.conflictsWith.includes(b) || rb.conflictsWith.includes(a);
      if (!conflict) continue;
      // Keep the one with higher coverage (measured by # of heal targets);
      // tie-break on higher OD cap (more headroom).
      const coverA = reagentCoversTypes(ra, data).size;
      const coverB = reagentCoversTypes(rb, data).size;
      let drop: string;
      if (coverA > coverB) drop = b;
      else if (coverB > coverA) drop = a;
      else if (odThresholdFor(ra) >= odThresholdFor(rb)) drop = b;
      else drop = a;
      toDrop.add(drop);
      const keep = drop === a ? b : a;
      warnings.push(
        `Razorium: ${a} and ${b} conflict — kept ${keep}, dropped ${drop}.`,
      );
    }
  }
  // Secondary brute-meds check: even if not directly listed (rare), at most
  // one member of BRUTE_MEDS allowed.
  const bruteHits = picked.filter(
    (id) => BRUTE_MEDS.has(id) && !toDrop.has(id),
  );
  if (bruteHits.length > 1) {
    // Keep the first (best ranked); drop the rest.
    const [keep, ...rest] = bruteHits;
    for (const drop of rest) {
      toDrop.add(drop);
      warnings.push(
        `Razorium: multiple brute meds in mix — kept ${keep}, dropped ${drop}.`,
      );
    }
  }
  return {
    ingredients: ingredients.filter((i) => !toDrop.has(i.reagentId)),
    warnings,
  };
}

// ---------- Cryo routing ----------

function selectCryoReagent(
  uncovered: Map<DamageTypeId, number>,
  data: DataBundle,
): { reagentId: string; targetTemp: number } {
  const types = [...uncovered.keys()];
  const cellularOnly = types.length === 1 && types[0] === 'Cellular';
  const heatFocused =
    types.length > 0 && types.every((t) => t === 'Heat' || t === 'Cold');
  const multiDamage = types.length >= 2;
  if (cellularOnly && data.reagentsById.has('Doxarubixadone')) {
    return { reagentId: 'Doxarubixadone', targetTemp: 150 };
  }
  if (heatFocused && data.reagentsById.has('Aloxadone')) {
    return { reagentId: 'Aloxadone', targetTemp: 150 };
  }
  if (multiDamage && data.reagentsById.has('Cryoxadone')) {
    return { reagentId: 'Cryoxadone', targetTemp: 213 };
  }
  // Default: Cryoxadone if available, otherwise any cryo reagent.
  if (data.reagentsById.has('Cryoxadone')) {
    return { reagentId: 'Cryoxadone', targetTemp: 213 };
  }
  return { reagentId: 'Cryoxadone', targetTemp: 213 };
}

// ---------- Physical items ----------

/**
 * Fold Healing's `bloodlossModifier` and `modifyBloodLevel` into a synthetic
 * per-application Bloodloss heal amount for solver purposes. The SS14 game
 * models these as separate systems (active-bleed slowdown vs blood pool
 * restoration), but from the medic's POV they both reduce the displayed
 * Bloodloss reading over time. We conservatively fold them at their raw
 * magnitudes (e.g. BloodPack's modifyBloodLevel: 15 → 15 Bloodloss), so the
 * solver recommends a roughly accurate count.
 */
function syntheticBloodlossHeal(item: PhysicalItem): number {
  const fromDamage = item.healsPerApplication.Bloodloss ?? 0;
  // bloodlossModifier is negative for healing; flip sign.
  const fromBleedModifier =
    item.bloodlossModifier < 0 ? Math.abs(item.bloodlossModifier) : 0;
  // modifyBloodLevel > 0 tops up blood volume directly (BloodPack: 15).
  const fromBloodLevel = item.modifyBloodLevel > 0 ? item.modifyBloodLevel : 0;
  return fromDamage + fromBleedModifier + fromBloodLevel;
}

/**
 * Effective per-type heal including bloodloss synthetics. Anything not
 * Bloodloss comes straight from `healsPerApplication`.
 */
function effectiveHealPerApplication(
  item: PhysicalItem,
  type: DamageTypeId,
): number {
  if (type === 'Bloodloss') return syntheticBloodlossHeal(item);
  return item.healsPerApplication[type] ?? 0;
}

function pickPhysicalItems(
  damage: DamageProfile,
  input: SolverInput,
  data: DataBundle,
): { physical: SolverPhysicalEntry[]; remaining: Map<DamageTypeId, number> } {
  const remaining = new Map<DamageTypeId, number>();
  for (const t of TREATABLE_DAMAGE_TYPES) {
    const v = damage[t] ?? 0;
    if (v > 0) remaining.set(t, v);
  }
  const out: SolverPhysicalEntry[] = [];

  // Score items by total per-application coverage (including synthetic
  // Bloodloss heal from bloodlossModifier + modifyBloodLevel). Ties fall back
  // to sum of raw healsPerApplication so Ointment still edges out Gauze on
  // burns even though their Bloodloss synthetics tie.
  const sortedItems = [...data.physicalItems].sort((a, b) => {
    const scoreA =
      Object.values(a.healsPerApplication).reduce((s, v) => s + v, 0) +
      syntheticBloodlossHeal(a);
    const scoreB =
      Object.values(b.healsPerApplication).reduce((s, v) => s + v, 0) +
      syntheticBloodlossHeal(b);
    return scoreB - scoreA;
  });

  for (const item of sortedItems) {
    // Skip iron-metabolism items for incompatible species. In current VS14
    // data none of the items have this flag set — see the resolver's comment.
    if (item.ironMetabolism && NON_IRON_METABOLISM_SPECIES.has(input.species)) {
      continue;
    }
    // Items that INFLICT damage they don't also heal (e.g. Tourniquet adds
    // Blunt + Asphyxiation and ONLY "heals" bleeding) are still useful for
    // their bloodloss stop, but we only propose them when Bloodloss is on
    // the damage profile — using a tourniquet on a non-bleeding patient is
    // actively harmful.
    const healsOnlyViaBleed =
      Object.keys(item.healsPerApplication).length === 0 &&
      item.bloodlossModifier < 0;
    if (healsOnlyViaBleed && (remaining.get('Bloodloss') ?? 0) <= 0) {
      continue;
    }
    if (
      Object.keys(item.damagePenalty).length > 0 &&
      (remaining.get('Bloodloss') ?? 0) <= 0
    ) {
      // Item inflicts damage (e.g. Tourniquet Blunt +5) — only pick when
      // there's active Bloodloss to justify the trade.
      continue;
    }

    const healedByType = new Map<string, number>();
    const stackCap = Math.max(item.stackSize, 10);
    let count = 0;
    while (count < stackCap) {
      // Hard cap = larger of stack size or 10 applications.
      let usefulHeal = 0;
      for (const t of TREATABLE_DAMAGE_TYPES) {
        const per = effectiveHealPerApplication(item, t);
        if (per <= 0) continue;
        const rem = remaining.get(t) ?? 0;
        if (rem > 0) usefulHeal += Math.min(rem, per);
      }
      if (usefulHeal <= 0) break;
      for (const t of TREATABLE_DAMAGE_TYPES) {
        const per = effectiveHealPerApplication(item, t);
        if (per <= 0) continue;
        const rem = remaining.get(t) ?? 0;
        if (rem > 0) {
          const applied = Math.min(rem, per);
          healedByType.set(t, (healedByType.get(t) ?? 0) + applied);
          remaining.set(t, rem - applied);
        }
      }
      count += 1;
    }
    if (count > 0) {
      const healedSummary = [...healedByType.entries()]
        .filter(([, a]) => a > 0)
        .map(([t, a]) => `${Math.round(a * 10) / 10} ${t}`)
        .join(' + ');
      out.push({
        itemId: item.id,
        count,
        reason: `${item.name} × ${count} — covers ${healedSummary}.`,
      });
    }
  }

  return { physical: out, remaining };
}

// ---------- Main entry ----------

export function computeMix(input: SolverInput, data: DataBundle): SolverOutput {
  const warnings: string[] = [];

  // Validate damage: strip any non-treatable types, sanitize negatives.
  const damage: Record<string, number> = {};
  let anyDamage = false;
  for (const t of TREATABLE_DAMAGE_TYPES) {
    const v = Math.max(0, input.damage[t] ?? 0);
    if (v > 0) {
      damage[t] = v;
      anyDamage = true;
    }
  }
  // Holy is excluded from the input form; if someone somehow included it,
  // quietly note it.
  if (
    'Holy' in (input.damage as Record<string, unknown>) &&
    Number((input.damage as Record<string, unknown>).Holy ?? 0) > 0
  ) {
    warnings.push(
      "Holy damage ignored — cult-only, chaplain's domain, not Nurseshark's.",
    );
  }

  if (!anyDamage) {
    return {
      ingredients: [],
      physical: [],
      cryo: null,
      warnings: ['No damage entered — nothing to solve.'],
      label: '',
      estimatedTimeSec: null,
      solved: false,
    };
  }

  // Filter: all-off case.
  const { chems, physical: physicalOn, cryo: cryoOn } = input.filters;
  if (!chems && !physicalOn && !cryoOn) {
    return {
      ingredients: [],
      physical: [],
      cryo: null,
      warnings: [
        'No treatments enabled — check at least one of Chems, Physical, or Cryo.',
      ],
      label: '',
      estimatedTimeSec: null,
      solved: true,
    };
  }

  // ---- Physical first (if enabled) — reduces remaining damage before chem pass.
  let remainingDamage = new Map<DamageTypeId, number>();
  for (const t of TREATABLE_DAMAGE_TYPES) {
    const v = damage[t] ?? 0;
    if (v > 0) remainingDamage.set(t, v);
  }
  const physicalOut: SolverPhysicalEntry[] = [];
  if (physicalOn) {
    const physResult = pickPhysicalItems(damage as DamageProfile, input, data);
    physicalOut.push(...physResult.physical);
    remainingDamage = physResult.remaining;
  }
  // Snapshot the post-physical pre-chem remaining bloodloss — used by the
  // species overlay, which shouldn't care about damage the chem pass later
  // virtually-covered using an iron-metabolism reagent.
  const bloodlossBeforeChems = remainingDamage.get('Bloodloss') ?? 0;

  // ---- Chem pass (if enabled).
  const ingredientsMap = new Map<string, SolverIngredient>();
  // Track per-reagent what damage it was picked for, so each reason can be built.
  const reasonContrib = new Map<
    string,
    Array<{ type: DamageTypeId; dose: number; covered: number }>
  >();
  // Over-damage flags: track types that can't be covered in a single OD-legal dose.
  const partialHealTypes = new Set<DamageTypeId>();
  const uncoveredForCryo = new Map<DamageTypeId, number>();

  if (chems) {
    const pickOrder = [...PICK_ORDER].filter(
      (t) => (remainingDamage.get(t) ?? 0) > 0,
    );
    // Re-sort after PICK_ORDER: within the same priority band, higher damage first.
    pickOrder.sort((a, b) => {
      const ia = PICK_ORDER.indexOf(a);
      const ib = PICK_ORDER.indexOf(b);
      if (ia !== ib) return ia - ib;
      return (remainingDamage.get(b) ?? 0) - (remainingDamage.get(a) ?? 0);
    });

    for (const type of pickOrder) {
      const remaining = remainingDamage.get(type) ?? 0;
      if (remaining <= 0) continue;

      // If an existing ingredient already covers this type, deduct its
      // contribution from `remaining` before picking a new one.
      let alreadyCovered = 0;
      for (const [rid, ing] of ingredientsMap) {
        const r = data.reagentsById.get(rid);
        if (!r) continue;
        if (healRateForType(r, type, data) > 0) {
          const rateType = healRateForType(r, type, data);
          const healPerUnit = rateType / r.metabolismRate;
          alreadyCovered += healPerUnit * ing.units;
        }
      }
      const leftover = remaining - alreadyCovered;
      if (leftover <= 0) {
        remainingDamage.set(type, 0);
        continue;
      }

      const includeRestricted = input.includeRestricted === true;
      const cands = candidatesFor(
        type,
        damage as DamageProfile,
        data,
        includeRestricted,
      );
      if (cands.length === 0) {
        // No reagent treats this type.
        partialHealTypes.add(type);
        uncoveredForCryo.set(type, leftover);
        continue;
      }

      // "Best match was restricted" warning: if we're NOT including
      // restricted reagents, peek at the unfiltered list and compare. If
      // the top-ranked unfiltered pick is blacklisted, let the medic know
      // we fell back to the next-best craftable option.
      if (!includeRestricted) {
        const unfiltered = candidatesFor(
          type,
          damage as DamageProfile,
          data,
          true,
        );
        const topUnfiltered = unfiltered[0];
        if (topUnfiltered && isBlacklisted(topUnfiltered.reagent.id)) {
          // Only emit the warning if the top restricted pick is actually
          // better (different from our best craftable).
          if (topUnfiltered.reagent.id !== cands[0].reagent.id) {
            const entry = blacklistEntry(topUnfiltered.reagent.id);
            const reasonTag = entry ? ` (${entry.reason})` : '';
            warnings.push(
              `Best match for ${type} (${topUnfiltered.reagent.id}) is restricted${reasonTag} — falling back to ${cands[0].reagent.id}.`,
            );
          }
        }
      }
      const best = cands[0];
      const dose = computeDose(best, leftover);
      const healed = effectiveHealForDose(best, dose, type, data);
      const existing = ingredientsMap.get(best.reagent.id);
      if (existing) {
        // Increase existing dose up to OD cap.
        const maxDose = Number.isFinite(best.odCap)
          ? Math.floor(best.odCap)
          : dose + existing.units;
        const newUnits = Math.min(maxDose, existing.units + dose);
        ingredientsMap.set(best.reagent.id, {
          reagentId: best.reagent.id,
          units: newUnits,
          reason: existing.reason, // will rebuild below
        });
      } else {
        ingredientsMap.set(best.reagent.id, {
          reagentId: best.reagent.id,
          units: dose,
          reason: '', // rebuilt below
        });
      }
      const contribs = reasonContrib.get(best.reagent.id) ?? [];
      contribs.push({ type, dose, covered: Math.min(healed, leftover) });
      reasonContrib.set(best.reagent.id, contribs);

      // Update remaining damage across all types this reagent covers.
      const actualUnits = ingredientsMap.get(best.reagent.id)?.units ?? dose;
      // Recompute actual heal per type from total units on this reagent.
      for (const t of best.covers) {
        const rem = remainingDamage.get(t) ?? 0;
        if (rem <= 0) continue;
        const rate = healRateForType(best.reagent, t, data);
        if (rate <= 0) continue;
        const healPerUnit = rate / best.reagent.metabolismRate;
        const delivered = healPerUnit * actualUnits;
        remainingDamage.set(t, Math.max(0, rem - delivered));
      }

      // Partial-heal check on this type specifically.
      if (healed < leftover) {
        partialHealTypes.add(type);
        const stillNeeded = leftover - healed;
        uncoveredForCryo.set(
          type,
          (uncoveredForCryo.get(type) ?? 0) + stillNeeded,
        );
      }
    }

    // Build reason strings.
    for (const ing of ingredientsMap.values()) {
      const r = data.reagentsById.get(ing.reagentId);
      if (!r) continue;
      const contribs = reasonContrib.get(ing.reagentId) ?? [];
      const rawName = resolveFluentKey(data.fluent, r.name) || prettifyId(r.id);
      // Title-case for prose: "bicaridine" → "Bicaridine".
      const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      const parts = contribs.map((c) => {
        const rate = healRateForType(r, c.type, data);
        return `covers ~${Math.round(c.covered)} ${c.type} @ ${rate}/tick`;
      });
      const od = odThresholdFor(r);
      const odStr = Number.isFinite(od) ? `; under OD ${od}u` : '';
      const reasonText =
        parts.length > 0
          ? `${name} × ${ing.units}u — ${parts.join(', ')}${odStr}.`
          : `${name} × ${ing.units}u — included for profile coverage${odStr}.`;
      // Replace with rebuilt reason (Map entries are references, but we
      // re-set to be safe).
      ingredientsMap.set(ing.reagentId, {
        reagentId: ing.reagentId,
        units: ing.units,
        reason: reasonText,
      });
    }
  } else {
    // Chems off — everything still-needed goes to cryo or is flagged.
    for (const [t, v] of remainingDamage) {
      if (v > 0) uncoveredForCryo.set(t, v);
    }
  }

  // ---- Species overlay + razorium pass on chem ingredients.
  let ingredients = [...ingredientsMap.values()];
  if (chems) {
    const razor = enforceRazorium(ingredients, data);
    ingredients = razor.ingredients;
    warnings.push(...razor.warnings);

    // Bloodloss to overlay is the POST-physical, PRE-chem amount — we don't
    // want the chem pass's virtual iron-metabolism coverage to mask the need
    // for Saline.
    const overlay = applySpeciesOverlay(
      ingredients,
      input,
      data,
      bloodlossBeforeChems,
    );
    ingredients = overlay.ingredients;
    warnings.push(...overlay.warnings);
  }

  // ---- Cryo fallback.
  let cryo: SolverCryoEntry | null = null;
  if (cryoOn && uncoveredForCryo.size > 0) {
    const pick = selectCryoReagent(uncoveredForCryo, data);
    const r = data.reagentsById.get(pick.reagentId);
    // Compute a reasonable cryo dose: 30u by default, capped at OD if any,
    // else scaled to total uncovered damage at a nominal rate.
    const totalUncovered = [...uncoveredForCryo.values()].reduce(
      (s, v) => s + v,
      0,
    );
    let units = 30;
    if (r) {
      const od = odThresholdFor(r);
      if (Number.isFinite(od)) units = Math.min(units, Math.floor(od));
      // If total uncovered is small, reduce units to match.
      if (totalUncovered < 20 && units > 15) units = 15;
    }
    const types = [...uncoveredForCryo.keys()].join(' + ');
    const name = r
      ? resolveFluentKey(data.fluent, r.name) || prettifyId(r.id)
      : pick.reagentId;
    cryo = {
      reagentId: pick.reagentId,
      units,
      targetTemp: pick.targetTemp,
      reason: `${name} × ${units}u @ ${pick.targetTemp}K — routes remaining ${Math.round(totalUncovered)} dmg (${types}) to cryo tube.`,
    };
  } else if (!cryoOn && partialHealTypes.size > 0) {
    warnings.push(
      `Partial heal for ${[...partialHealTypes].join(', ')} — administer this mix and re-scan. Consider enabling cryo for full coverage.`,
    );
  }

  // ---- Species overlay may inject Saline even when bloodloss healer
  //      was picked — handled inside applySpeciesOverlay. Also handle
  //      case where chems was off but bloodloss > 0 and species is
  //      non-iron: we should NOT inject a Saline ingredient (chems off
  //      means no chems at all).

  // ---- Estimate time.
  let estimatedTimeSec: number | null = null;
  if (ingredients.length > 0) {
    // Worst-case: longest single-reagent metabolization window.
    let longest = 0;
    for (const ing of ingredients) {
      const r = data.reagentsById.get(ing.reagentId);
      if (!r) continue;
      const ticks = ing.units / r.metabolismRate;
      const secs = ticks * TICK_SECONDS;
      if (secs > longest) longest = secs;
    }
    estimatedTimeSec = Math.round(longest);
  }

  // ---- Label.
  const firstIng = ingredients[0];
  const firstReagent = firstIng
    ? data.reagentsById.get(firstIng.reagentId)
    : null;
  const labelName = firstReagent
    ? resolveFluentKey(data.fluent, firstReagent.name) ||
      prettifyId(firstReagent.id)
    : cryo
      ? 'Rx mix'
      : 'Rx';
  const totalUnits = ingredients.reduce((s, i) => s + i.units, 0);
  const label =
    ingredients.length > 0
      ? buildLabel({
          reagentName:
            ingredients.length === 1 ? labelName : `Mix${ingredients.length}`,
          units: totalUnits,
          operatorName: input.operatorName,
        })
      : cryo
        ? buildLabel({
            reagentName: 'Cryo',
            units: cryo.units,
            operatorName: input.operatorName,
          })
        : '';

  // ---- OD proximity warnings.
  for (const ing of ingredients) {
    const r = data.reagentsById.get(ing.reagentId);
    if (!r) continue;
    const od = odThresholdFor(r);
    if (Number.isFinite(od) && ing.units >= od) {
      warnings.push(
        `${r.id}: ${ing.units}u meets OD threshold (${od}u) — split doses or accept partial heal.`,
      );
    }
  }

  return {
    ingredients,
    physical: physicalOut,
    cryo,
    warnings,
    label,
    estimatedTimeSec,
    solved: true,
  };
}
