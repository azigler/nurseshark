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
  SolverAlternative,
  SolverAlternativeKind,
  SolverAlternatives,
  SolverCryoEntry,
  SolverIngredient,
  SolverInput,
  SolverOutput,
  SolverPhysicalEntry,
  SolverRevivalStep,
} from '../types';
import { prettifyId, resolveFluentKey } from './fluent';
import { blacklistEntry, isBlacklisted } from './reagent-blacklist';
import {
  physicalItemTierEntry,
  physicalItemTierFor,
  type ReagentTier,
  tierEntry,
  tierFor,
} from './reagent-tiers';
import {
  CONDITIONAL_HEAL_WARNINGS,
  OD_PROXIMITY_WARNINGS,
  STATIC_WARNINGS,
} from './side-effect-warnings';
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
 * Cryo-class reagents — reagents that exist primarily for the cryogenics
 * tube flow. They have broad `heals[]` entries that would otherwise dominate
 * the standard chem pass (Cryoxadone covers Brute/Burn/Toxin/Airloss at
 * 2-3/tick), so when the medic unchecks the "cryo" filter we must exclude
 * them from BOTH the chem candidate pool AND the cryo-tube emission. A
 * cryo-off plan should be makeable without ever opening a cryo tube — the
 * vs-xvp.1 fix.
 */
const CRYO_REAGENTS: ReadonlySet<string> = new Set([
  'Cryoxadone',
  'Doxarubixadone',
  'Aloxadone',
  'Opporozidone',
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

// ---------- Per-ingredient side-effect warnings ----------
//
// Every picked ingredient carries a `sideEffectWarnings[]` list (vs-3il.5).
// Warnings come from three sources:
//   1. `STATIC_WARNINGS` map (unconditional — Ultravasculine, Arithrazine).
//   2. The reagent's own `sideEffects[]` data (auto-phrased from the pipeline
//      when no hand-authored override exists).
//   3. Context-sensitive advisories (Tricord + high total damage, Epi + non-
//      critical patient, Dermaline at/near OD).

/** Sum non-zero damage amounts to estimate the patient's "total damage". */
function estimateTotalDamage(damage: DamageProfile): number {
  let total = 0;
  for (const v of Object.values(damage)) {
    if (typeof v === 'number' && v > 0) total += v;
  }
  return total;
}

/**
 * Build the `sideEffectWarnings[]` array for a picked ingredient. Combines
 * the static wiki-authored map with context-derived advisories (high-damage
 * Tricord, non-crit Epi, near-OD Dermaline) and falls back to auto-phrased
 * side-effect data for reagents with no curated copy.
 */
function buildSideEffectWarnings(
  reagent: Reagent,
  units: number,
  input: SolverInput,
): string[] {
  const warnings: string[] = [];

  // 1. Static warnings (hand-authored).
  const stat = STATIC_WARNINGS[reagent.id];
  if (stat) warnings.push(stat.text);

  // 2. Auto-derived from side-effect data when no static override provided.
  //    Only fires when nothing else covered this reagent — avoids double-text
  //    on Ultravasculine/Arithrazine.
  if (!stat && (reagent.sideEffects?.length ?? 0) > 0) {
    for (const se of reagent.sideEffects ?? []) {
      if (se.type === 'damage') {
        const cond = se.condition ? ` (${se.condition})` : '';
        warnings.push(
          `${reagent.id}: inflicts ${se.amount} ${se.target} per tick${cond}.`,
        );
      }
      // Status effects (Vomit/Jitter/Drowsiness) are gated on self-concentration
      // and already flagged by the existing OD-proximity warning when dose ≥
      // threshold. Skip to avoid noise.
    }
  }

  // 3. OD-proximity (hand-authored).
  const odMsg = OD_PROXIMITY_WARNINGS[reagent.id];
  if (odMsg) {
    const od = odThresholdFor(reagent);
    if (Number.isFinite(od) && units >= od - odMsg.nearOdMargin) {
      warnings.push(odMsg.text);
    }
  }

  // 4. Tricordrazine: fires advisory when total damage ≥ 50 (wiki-gated).
  if (reagent.id === 'Tricordrazine') {
    const total = estimateTotalDamage(input.damage);
    if (total >= 50) {
      const msg = CONDITIONAL_HEAL_WARNINGS.Tricordrazine?.tricordHighDamage;
      if (msg) warnings.push(msg);
    }
  }

  // 5. Epinephrine: critical-only Brute/Burn/Poison heal. When the patient
  //    profile carries those damage types but the input doesn't flag crit,
  //    advise that the non-crit heal path won't fire. (The solver has no
  //    explicit "is in crit" input — we conservatively warn any time Epi is
  //    picked against a Brute/Burn/Poison profile.)
  if (reagent.id === 'Epinephrine') {
    const hasConditionalTarget =
      (input.damage.Blunt ?? 0) > 0 ||
      (input.damage.Piercing ?? 0) > 0 ||
      (input.damage.Slash ?? 0) > 0 ||
      (input.damage.Heat ?? 0) > 0 ||
      (input.damage.Shock ?? 0) > 0 ||
      (input.damage.Cold ?? 0) > 0 ||
      (input.damage.Poison ?? 0) > 0 ||
      (input.damage.Caustic ?? 0) > 0;
    if (hasConditionalTarget) {
      const msg = CONDITIONAL_HEAL_WARNINGS.Epinephrine?.epiNonCritical;
      if (msg) warnings.push(msg);
    }
  }

  return warnings;
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
  /** Availability tier (vs-xvp.2). 1 = fridge stock, 2 = specialized, 3 = exotic. */
  readonly tier: ReagentTier;
}

/**
 * Tier-preference weight (vs-xvp.2, recalibrated vs-xvp.4). Used as an
 * additive deboost on the heal-rate score: a tier-N reagent's effective
 * score is `ratePerUnitPerSec − (tier − 1) × TIER_RATE_BIAS`. When
 * coverage ties (the strict first sort key), the lower-tier reagent
 * usually wins unless the higher-tier alternative is dramatically faster.
 *
 * Calibration history:
 *   vs-xvp.2: 0.4 — "small deboost, still let a clearly-better
 *             higher-tier reagent win." Empirically too weak: in-game
 *             testing surfaced Ultravasculine (tier 3, 6/tick Toxin
 *             group → 3.0/sec) being recommended for pure Poison
 *             profiles over Dylovene (tier 1, 1/tick → 0.5/sec) because
 *             3.0 − 0.4×2 = 2.2 still beat 0.5. The medic's complaint:
 *             "exotic chem surfaced as suggestion despite Dylovene
 *             being fridge-stocked." (vs-xvp.4 surface report.)
 *   vs-xvp.4: 2.0 — strong enough to suppress tier-3 chems when a
 *             tier-1 alternative covers the same damage type. With
 *             bias 2.0:
 *               * Ultravasculine score = 3.0 − 4.0 = −1.0
 *               * Dylovene score = 0.5 − 0 = 0.5 → Dylovene wins ✓
 *             Tier-2 picks still win when their rate is ~2.5× a
 *             tier-1 alternative (which is the threshold where a synth
 *             run is genuinely worth the medic's time). Cellular and
 *             other no-tier-1-alternative damage types are unaffected
 *             because there's no tier-1 to bias toward.
 *
 * The bias does NOT override the strict profile-coverage sort: if a
 * tier-3 reagent covers two damage types in the input profile and a
 * tier-1 reagent covers only one, the tier-3 reagent still wins. This
 * is correct — the solver should escalate when escalation lets it pack
 * coverage into fewer reagents.
 */
const TIER_RATE_BIAS = 2.0;

/**
 * Physical-item tier deboost (vs-xvp.4). Same calibration philosophy as
 * `TIER_RATE_BIAS` but applied to the physical-item ranking sort, where
 * the score is `sum(healsPerApplication) + syntheticBloodlossHeal`.
 * MedicatedSuture (tier 3, sum=30) and RegenerativeMesh (tier 3, sum=40)
 * would otherwise out-score Brutepack (tier 1, sum=15) and Ointment
 * (tier 1, sum=16.5) — so a 20-per-tier deboost makes tier-3 items lose
 * to tier-1 items when both cover the same damage class. The bias
 * doesn't kick in unless a tier-1 alternative actually provides
 * coverage; if no tier-1 item touches the damage type, the higher-tier
 * item still wins because its score is the only positive number.
 */
const PHYSICAL_TIER_RATE_BIAS = 20;

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
  cryoOn: boolean,
  tierCeiling: ReagentTier = 3,
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
    // Cryo filter (vs-xvp.1): when the medic unchecks "cryo" they're saying
    // "I have no access to a cryo tube — don't recommend Cryoxadone /
    // Doxarubixadone / Aloxadone / Opporozidone." These reagents otherwise
    // dominate the chem ranking on broad-coverage profiles because of their
    // group-heal entries, which would have the solver silently route the
    // medic toward cryo even when they explicitly said no.
    if (!cryoOn && CRYO_REAGENTS.has(r.id)) continue;
    // Tier ceiling (vs-xvp.5): when the medic is exploring "what would I
    // prescribe if I only had fridge-stock?" or "what's my standard
    // medical chems plan?" the solver caps the candidate pool at the
    // requested ceiling. Reagents above the ceiling are excluded outright,
    // not deboosted.
    if (tierFor(r.id) > tierCeiling) continue;
    const covers = reagentCoversTypes(r, data);
    // How much of the INPUT profile does this reagent cover?
    let profileCoverage = 0;
    for (const t of covers) if (nonZeroInput.has(t)) profileCoverage += 1;
    const odCap = odThresholdFor(r);
    // rate per unit per sec: amountPerTick * metabolismRate (units/tick) gives
    // damage healed per second per unit of reagent in body.
    const ratePerUnitPerSec = rateType * r.metabolismRate;
    const tier = tierFor(r.id);
    candidates.push({
      reagent: r,
      ratePerUnitPerSec,
      covers,
      profileCoverage,
      odCap,
      tier,
    });
  }

  candidates.sort((a, b) => {
    // 1. Higher profile coverage first. Tier never overrides coverage —
    //    we don't pick a tier-1 chem that misses damage types the patient
    //    is bleeding from. (vs-xvp.2)
    if (b.profileCoverage !== a.profileCoverage) {
      return b.profileCoverage - a.profileCoverage;
    }
    // 2. Lower tier preferred when coverage ties (vs-xvp.2). Combined with
    //    rate so a clearly-better higher-tier reagent can still win, but
    //    same-rate ties go to the basic chem. Score = rate − (tier-1)*BIAS.
    const scoreA = a.ratePerUnitPerSec - (a.tier - 1) * TIER_RATE_BIAS;
    const scoreB = b.ratePerUnitPerSec - (b.tier - 1) * TIER_RATE_BIAS;
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
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

/**
 * Build the `tierReason` string for a picked ingredient (vs-xvp.2). When a
 * tier-1 chem covered the picked damage types, returns null (no escalation
 * needed; the badge is enough). When the pick is tier 2/3, explain why the
 * tier-1 alternatives were insufficient — the medic learns when to expect a
 * synth run vs reach for the fridge.
 */
function buildTierReason(
  cand: Candidate,
  pickedTypes: readonly DamageTypeId[],
  damage: DamageProfile,
  data: DataBundle,
  cryoOn: boolean,
): string | null {
  if (cand.tier === 1) return null;
  const entry = tierEntry(cand.reagent.id);
  const baseRationale = entry?.rationale ?? '';

  // Find which picked damage types had no tier-1 alternative AND track the
  // best tier-1 rate for the ones that did. We use the rate ratio to decide
  // between two phrasings: "no fridge-stock alternative" vs "much higher
  // rate than the fridge-stock alternative".
  const nonZeroInput = (Object.keys(damage) as DamageTypeId[]).filter(
    (k) => (damage[k] ?? 0) > 0,
  );
  const uncoveredByTier1: DamageTypeId[] = [];
  let bestTier1Rate = 0;
  let candRateForPicked = 0;
  for (const t of pickedTypes) {
    let tier1Rate = 0;
    for (const r of data.reagents) {
      if (isBlacklisted(r.id)) continue;
      if (tierFor(r.id) !== 1) continue;
      const rt = healRateForType(r, t, data);
      if (rt <= 0) continue;
      const score = rt * r.metabolismRate;
      if (score > tier1Rate) tier1Rate = score;
    }
    if (tier1Rate <= 0) {
      uncoveredByTier1.push(t);
    } else if (tier1Rate > bestTier1Rate) {
      bestTier1Rate = tier1Rate;
    }
    const candR = healRateForType(cand.reagent, t, data);
    const candScore = candR * cand.reagent.metabolismRate;
    if (candScore > candRateForPicked) candRateForPicked = candScore;
  }

  if (uncoveredByTier1.length > 0) {
    return `Tier ${cand.tier}: no fridge-stock chem covers ${uncoveredByTier1.join(', ')}. ${baseRationale}`.trim();
  }
  const profileTypes = nonZeroInput.join(', ');
  // Cryo-on edge case: when cryo is enabled, Cryoxadone's group coverage
  // routinely beats single-type tier-1 picks for multi-damage profiles.
  // Phrase the rationale accordingly.
  if (cryoOn && cand.reagent.id === 'Cryoxadone') {
    return `Tier 2 (cryo on): Cryoxadone covers the full profile (${profileTypes}) in one chem. ${baseRationale}`.trim();
  }
  // Pure-rate escalation: the tier-1 alternative existed but this pick is
  // dramatically faster (≥1.5×). Tell the medic they have a fridge-stock
  // option if they don't want to synth.
  if (bestTier1Rate > 0 && candRateForPicked >= bestTier1Rate * 1.5) {
    return `Tier ${cand.tier}: ~${(candRateForPicked / bestTier1Rate).toFixed(1)}× the heal rate of fridge-stock alternatives for ${profileTypes}. ${baseRationale}`.trim();
  }
  return `Tier ${cand.tier}: better profile coverage than tier-1 alternatives for ${profileTypes}. ${baseRationale}`.trim();
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
        sideEffectWarnings: [],
        tier: tierFor(ARACHNID_BLOOD_RESTORER),
        tierReason: null,
      });
    } else {
      const needed = Math.max(5, Math.ceil(bloodloss / SALINE_HEAL_PER_UNIT));
      out.push({
        reagentId: 'Saline',
        units: needed,
        reason: `Saline × ${needed}u — covers ${bloodloss} Bloodloss for Arachnid (Copper unavailable; Iron is toxic to Arachnids).`,
        sideEffectWarnings: [],
        tier: tierFor('Saline'),
        tierReason: null,
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
      sideEffectWarnings: [],
      tier: tierFor('Saline'),
      tierReason: null,
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
  // Bloodloss heal from bloodlossModifier + modifyBloodLevel), with a
  // tier-based deboost (vs-xvp.4) so tier-3 items (MedicatedSuture,
  // RegenerativeMesh) lose to tier-1 alternatives that cover the same
  // damage class. Ties fall back to sum of raw healsPerApplication so
  // Ointment still edges out Gauze on burns even though their Bloodloss
  // synthetics tie.
  const sortedItems = [...data.physicalItems].sort((a, b) => {
    const rawA =
      Object.values(a.healsPerApplication).reduce((s, v) => s + v, 0) +
      syntheticBloodlossHeal(a);
    const rawB =
      Object.values(b.healsPerApplication).reduce((s, v) => s + v, 0) +
      syntheticBloodlossHeal(b);
    const scoreA =
      rawA - (physicalItemTierFor(a.id) - 1) * PHYSICAL_TIER_RATE_BIAS;
    const scoreB =
      rawB - (physicalItemTierFor(b.id) - 1) * PHYSICAL_TIER_RATE_BIAS;
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
      // vs-xvp.4: when a tier-3 physical item still made the cut (because
      // no tier-1 alternative covered the damage class, or because its
      // raw heal score won despite the deboost), append the tier
      // rationale so the medic understands why an advanced-medkit item
      // is being recommended.
      const tEntry = physicalItemTierEntry(item.id);
      const tierNote =
        tEntry && tEntry.tier === 3 ? ` Tier 3: ${tEntry.rationale}` : '';
      out.push({
        itemId: item.id,
        count,
        reason: `${item.name} × ${count} — covers ${healedSummary}.${tierNote}`,
      });
    }
  }

  return { physical: out, remaining };
}

// ---------- Dead-patient revival flow (vs-3il.6) ----------
//
// When `patientState === "dead"` the solver switches to a revival-first flow:
//
//   1. Reagents don't metabolize in corpses, so skip the chem pass entirely
//      for the primary pick. Topicals (physical items) are the only thing
//      that reduces damage while the patient is flat-lined.
//   2. Defibrillators gate on total damage below 200 (SS14 in-game threshold).
//      So the goal is: pick topicals until projected damage < 200.
//   3. Once the patient is revivable, emit a `revivalStep` describing the
//      defibrillator use. The defib heals 40 Asphyxiation and inflicts 5
//      Shock — flat numbers from the in-game prototype, not a free parameter.
//   4. Project the post-defib damage profile (original − topical heals −
//      defib heals + defib inflicts) and re-run `computeMix` with
//      `patientState: "critical"` to produce `postRevivalIngredients`. This
//      gives the medic a chem plan for the implicitly-critical post-revival
//      state, with side-effect warnings intact.
//   5. If even a maximum-stack application of every available topical cannot
//      reduce projected damage below 200, emit the "cannot be revived via
//      available topicals; consult CMO" warning. No revivalStep is emitted.
//
// Wiki-voice advisory strings live in constants below to keep the render
// layer simple (it just stringifies the output).

/** In-game defibrillator total-damage threshold. Damage ≥ 200 → can't revive. */
const REVIVAL_DAMAGE_THRESHOLD = 200;

/** Asphyxiation healed by a single defib shock. */
const DEFIB_HEAL_ASPHYXIATION = 40;

/** Shock inflicted by a single defib shock (the medical cost of revival). */
const DEFIB_INFLICT_SHOCK = 5;

const DEFIB_NOTE = 'Press Z to activate, then use on patient.';

const REVIVAL_WARN_TOPICALS_FIRST =
  'Reduce total damage below 200 with topicals before defibrillating.';

const REVIVAL_WARN_POST_REVIVAL =
  'Post-revival: patient enters critical state. Continue with chemical treatment for remaining damage.';

const REVIVAL_WARN_DEFIB_PROFILE =
  'Defibrillate: heals 40 Asphyxiation, inflicts 5 Shock. Press Z to activate.';

const REVIVAL_WARN_CANNOT_REVIVE =
  'Patient cannot be revived via available topicals; consult CMO.';

/**
 * Greedily pick topicals for a dead patient, aiming to reduce total damage
 * below `REVIVAL_DAMAGE_THRESHOLD`. This is a stricter / goal-directed
 * variant of `pickPhysicalItems` — the caller cares about the total damage
 * projection, not per-type coverage.
 *
 * We iterate in descending per-application effectiveness (sum of heals +
 * synthetic Bloodloss heal) and keep applying until the total drops below
 * the threshold OR no item can make further progress. Unlike the normal
 * physical pass we DO NOT fold in items whose damagePenalty would push the
 * patient away from revivability (e.g. Tourniquet inflicts Blunt + Asphyxiation
 * — great for active bleed, risky when the goal is to drop under 200 total).
 */
function pickRevivalTopicals(
  damage: DamageProfile,
  data: DataBundle,
): {
  physical: SolverPhysicalEntry[];
  remaining: Map<DamageTypeId, number>;
  totalRemaining: number;
} {
  const remaining = new Map<DamageTypeId, number>();
  for (const t of TREATABLE_DAMAGE_TYPES) {
    const v = damage[t] ?? 0;
    if (v > 0) remaining.set(t, v);
  }
  const totalInitial = [...remaining.values()].reduce((s, v) => s + v, 0);
  let total = totalInitial;
  const out: SolverPhysicalEntry[] = [];

  // Sort items by total useful heal per application (brute items for brute
  // damage, burn items for burn damage, etc). Identical to pickPhysicalItems
  // scoring so we don't duplicate the ranking logic.
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
    if (total < REVIVAL_DAMAGE_THRESHOLD) break;
    // Skip items that inflict damage — dead patients don't benefit from the
    // bleeding-stop trade when the goal is raw total reduction.
    if (Object.keys(item.damagePenalty).length > 0) continue;
    // Bleeding-only items (Tourniquet) are filtered by the damagePenalty
    // check above; Gauze & MedicatedSuture pass through cleanly because
    // their bloodloss help is via bloodlossModifier with no penalty.

    const healedByType = new Map<string, number>();
    const stackCap = Math.max(item.stackSize, 10);
    let count = 0;
    while (count < stackCap && total >= REVIVAL_DAMAGE_THRESHOLD) {
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
          total -= applied;
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
        reason: `${item.name} × ${count} — covers ${healedSummary} (dead-mode: reducing toward defib threshold <200).`,
      });
    }
  }

  return { physical: out, remaining, totalRemaining: total };
}

/**
 * Dead-patient flow entry point. Wraps:
 *   1. Topical pick (`pickRevivalTopicals`) to reduce damage below 200.
 *   2. Revival-step emission when revivable.
 *   3. Post-defib damage projection + recursive solve with patientState=critical.
 *
 * Kept separate from `computeMix` so the standard flow stays readable and the
 * dead-mode branch stays self-contained.
 */
function computeDeadModeOutput(
  input: SolverInput,
  data: DataBundle,
  sanitizedDamage: DamageProfile,
): SolverOutput {
  const patientStateWarnings: string[] = [REVIVAL_WARN_TOPICALS_FIRST];
  const warnings: string[] = [];

  const topicalResult = pickRevivalTopicals(sanitizedDamage, data);
  const physical = topicalResult.physical;
  const totalAfterTopicals = topicalResult.totalRemaining;

  // Can the patient be revived? If topicals can't drop total below 200,
  // emit the cannot-revive warning and return without a revival step.
  if (totalAfterTopicals >= REVIVAL_DAMAGE_THRESHOLD) {
    patientStateWarnings.push(REVIVAL_WARN_CANNOT_REVIVE);
    return {
      ingredients: [],
      physical,
      cryo: null,
      warnings,
      label: '',
      estimatedTimeSec: null,
      solved: true,
      patientStateWarnings,
    };
  }

  // Project post-defib damage profile:
  //   - Start from remaining (post-topical) damage.
  //   - Apply defib heals (Asphyxiation -40).
  //   - Apply defib inflicts (Shock +5).
  const postDefib: Record<string, number> = {};
  for (const [t, v] of topicalResult.remaining) {
    if (v > 0) postDefib[t] = v;
  }
  const aspRem = postDefib.Asphyxiation ?? 0;
  postDefib.Asphyxiation = Math.max(0, aspRem - DEFIB_HEAL_ASPHYXIATION);
  if (postDefib.Asphyxiation === 0) delete postDefib.Asphyxiation;
  postDefib.Shock = (postDefib.Shock ?? 0) + DEFIB_INFLICT_SHOCK;

  const revivalStep: SolverRevivalStep = {
    tool: 'defibrillator',
    heals: { Asphyxiation: DEFIB_HEAL_ASPHYXIATION },
    inflicts: { Shock: DEFIB_INFLICT_SHOCK },
    note: DEFIB_NOTE,
  };
  patientStateWarnings.push(REVIVAL_WARN_DEFIB_PROFILE);
  patientStateWarnings.push(REVIVAL_WARN_POST_REVIVAL);

  // Re-solve the post-defib state with patientState=critical. We use the
  // same filters as the caller for the chem side — but physical is handled
  // above (dead-mode topicals) and cryo is a secondary concern for revival,
  // so force chems-only on the post-revival pass. The medic can re-enter
  // the profile for a full post-revival plan if they want cryo.
  let postRevivalIngredients: SolverIngredient[] = [];
  const hasPostDefibDamage = Object.values(postDefib).some((v) => v > 0);
  if (hasPostDefibDamage) {
    const postInput: SolverInput = {
      damage: postDefib as DamageProfile,
      species: input.species,
      filters: {
        chems: true,
        physical: false, // already handled by dead-mode topicals
        cryo: false, // secondary concern for post-revival
      },
      operatorName: input.operatorName,
      includeRestricted: input.includeRestricted,
      patientState: 'critical',
    };
    const postOut = computeMix(postInput, data);
    postRevivalIngredients = [...postOut.ingredients];
    // Forward post-revival warnings onto the top-level warnings list so the
    // medic still sees razorium / OD / species-overlay advisories.
    warnings.push(...postOut.warnings);
  }

  // Build a label for the revival flow: anchor on first post-revival
  // ingredient if any, else "Revive" + estimated topical count.
  const firstIng = postRevivalIngredients[0];
  const firstReagent = firstIng
    ? data.reagentsById.get(firstIng.reagentId)
    : null;
  const labelName = firstReagent
    ? resolveFluentKey(data.fluent, firstReagent.name) ||
      prettifyId(firstReagent.id)
    : 'Revive';
  const totalUnits = postRevivalIngredients.reduce((s, i) => s + i.units, 0);
  const label =
    postRevivalIngredients.length > 0
      ? buildLabel({
          reagentName:
            postRevivalIngredients.length === 1
              ? labelName
              : `Mix${postRevivalIngredients.length}`,
          units: totalUnits,
          operatorName: input.operatorName,
        })
      : '';

  // Estimate time: longest metabolization of post-revival ingredients.
  let estimatedTimeSec: number | null = null;
  if (postRevivalIngredients.length > 0) {
    let longest = 0;
    for (const ing of postRevivalIngredients) {
      const r = data.reagentsById.get(ing.reagentId);
      if (!r) continue;
      const ticks = ing.units / r.metabolismRate;
      const secs = ticks * TICK_SECONDS;
      if (secs > longest) longest = secs;
    }
    estimatedTimeSec = Math.round(longest);
  }

  return {
    ingredients: [],
    physical,
    cryo: null,
    warnings,
    label,
    estimatedTimeSec,
    solved: true,
    revivalStep,
    postRevivalIngredients,
    patientStateWarnings,
  };
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

  // Dead-patient revival flow (vs-3il.6). Switches the solver to topicals →
  // defib → post-revival chems. Kept before the filter/all-off guard because
  // dead-mode runs its own flow regardless of the top-level filter toggles.
  if (input.patientState === 'dead') {
    return computeDeadModeOutput(input, data, damage as DamageProfile);
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
  // Track the winning Candidate per picked reagent so the post-loop tier-
  // reason synthesis (vs-xvp.2) can examine its `tier` and original profile
  // coverage without re-deriving them.
  const candidateForReagent = new Map<string, Candidate>();
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
      const tierCeiling = (input.tierCeiling ?? 3) as ReagentTier;
      const cands = candidatesFor(
        type,
        damage as DamageProfile,
        data,
        includeRestricted,
        cryoOn,
        tierCeiling,
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
      // we fell back to the next-best craftable option. Keep the cryo gate
      // applied here too so the comparison is apples-to-apples — the medic
      // doesn't want to be told "we fell back from Cryoxadone" when cryo is
      // off (Cryoxadone shouldn't be a candidate at all in that case).
      if (!includeRestricted) {
        const unfiltered = candidatesFor(
          type,
          damage as DamageProfile,
          data,
          true,
          cryoOn,
          tierCeiling,
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
          sideEffectWarnings: [], // rebuilt below
          tier: best.tier,
          tierReason: null, // rebuilt below
        });
      } else {
        ingredientsMap.set(best.reagent.id, {
          reagentId: best.reagent.id,
          units: dose,
          reason: '', // rebuilt below
          sideEffectWarnings: [], // rebuilt below
          tier: best.tier,
          tierReason: null, // rebuilt below
        });
      }
      // Track the candidate metadata for tier-reason synthesis after the
      // chem-pick loop completes (vs-xvp.2). Last-write-wins is fine — same
      // reagent picked for additional types just appends to `contribs`.
      candidateForReagent.set(best.reagent.id, best);
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
      // Per-ingredient side-effect advisories (vs-3il.5) — static map +
      // context-derived (Tricord high-damage, Epi non-crit, Dermaline OD).
      const sideEffectWarnings = buildSideEffectWarnings(r, ing.units, input);
      // Tier reason (vs-xvp.2): only populated when tier > 1, explaining
      // why the solver had to escalate above fridge-stock chems.
      const cand = candidateForReagent.get(ing.reagentId);
      const pickedTypes = contribs.map((c) => c.type);
      const tierReason = cand
        ? buildTierReason(
            cand,
            pickedTypes,
            damage as DamageProfile,
            data,
            cryoOn,
          )
        : null;
      // Replace with rebuilt reason (Map entries are references, but we
      // re-set to be safe).
      ingredientsMap.set(ing.reagentId, {
        reagentId: ing.reagentId,
        units: ing.units,
        reason: reasonText,
        sideEffectWarnings,
        tier: ing.tier,
        tierReason,
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
  // vs-xvp.5: respect the tier ceiling on the cryo lane too. All cryo
  // reagents are tier 2 (Cryoxadone, Doxarubixadone, Aloxadone) or
  // tier 3 (Opporozidone), so a tier-1 ceiling means "no cryo" — we
  // emit the partial-heal warning instead, surfacing the inadequacy
  // honestly. (Otherwise the tier-1 alternative would silently rope in
  // tier-2 chems via cryo, defeating the "fridge stock only" promise.)
  const inputTierCeiling = (input.tierCeiling ?? 3) as ReagentTier;
  const cryoEffective = cryoOn && inputTierCeiling >= 2;
  let cryo: SolverCryoEntry | null = null;
  if (cryoEffective && uncoveredForCryo.size > 0) {
    const pick = selectCryoReagent(uncoveredForCryo, data);
    // Pin cryo pick to the tier ceiling: if the selected cryo reagent's
    // tier exceeds the ceiling, fall back to Cryoxadone (tier 2). At
    // ceiling 1 the lane is suppressed entirely above; at ceiling 2 we
    // accept Cryoxadone/Doxarubixadone/Aloxadone (all tier 2); at
    // ceiling 3 the full pick (including Opporozidone tier 3) is OK.
    const pickTier = tierFor(pick.reagentId);
    const finalReagent =
      pickTier > inputTierCeiling ? 'Cryoxadone' : pick.reagentId;
    const r = data.reagentsById.get(finalReagent);
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
      : finalReagent;
    cryo = {
      reagentId: finalReagent,
      units,
      targetTemp: pick.targetTemp,
      reason: `${name} × ${units}u @ ${pick.targetTemp}K — routes remaining ${Math.round(totalUncovered)} dmg (${types}) to cryo tube.`,
    };
  } else if (
    (!cryoOn || !cryoEffective) &&
    (partialHealTypes.size > 0 || uncoveredForCryo.size > 0)
  ) {
    const types = new Set<DamageTypeId>([
      ...partialHealTypes,
      ...uncoveredForCryo.keys(),
    ]);
    warnings.push(
      `Partial heal for ${[...types].join(', ')} — administer this mix and re-scan. Consider enabling cryo for full coverage.`,
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

// ---------- Ranked alternatives (vs-xvp.5) ----------
//
// `computeAlternatives` runs `computeMix` 2-3 times with progressively
// higher tier ceilings (1, 2, 3). The medic gets a list of collapsible
// cards on the Solver page, one per alternative, each carrying its own
// complete Rx (ingredients, physical items, cryo). The lowest-tier
// alternative that fully covers the damage profile is the default-
// expanded card; alternatives below it are collapsed by default.
//
// Trade-off summaries are wiki-voice one-liners that describe the tier
// scope ("Fridge stock only — partial coverage") so the medic can match
// a card to their actual inventory without re-running the solver.
//
// Duplicate suppression: when two adjacent tier ceilings produce the
// same picked-reagent set, only the lower-tier alternative is shown.
// (No medic wants to see "Standard medical chems" and "Includes exotics"
// rendering the same Rx twice.)

/**
 * Build the wiki-voice one-line trade-off summary for a single tier
 * alternative. Phrasing depends on (a) the tier ceiling and (b) whether
 * the alternative fully covers the damage profile.
 */
function buildAlternativeSummary(
  kind: SolverAlternativeKind,
  output: SolverOutput,
  partial: boolean,
): string {
  const partialNote = partial
    ? ' Partial coverage — re-scan after administering and consider escalating.'
    : '';
  switch (kind) {
    case 'fridge-stock':
      return `Fridge stock only — tier-1 chems the medic carries pre-made (Bicaridine, Dermaline, Tricord, Saline, Dylovene, etc.).${partialNote}`;
    case 'standard':
      return `Standard medical chems — tier-1 + chemmaster recipes (Bruizine, Pyrazine, Cryoxadone, etc.). One synth run from a clean medbay.${partialNote}`;
    case 'exotic-allowed':
      return `Includes exotics — tier-3 chems allowed (Ultravasculine, Aloxadone, Cognizine, etc.). Higher heal rates at the cost of botany / salvage / multi-system synth.${partialNote}`;
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = kind;
      void output;
      return `Unrecognised alternative kind: ${String(_exhaustive)}`;
    }
  }
}

/**
 * Build a single alternative for the given tier ceiling. Internally calls
 * `computeMix` with `tierCeiling` set; the rest of the input passes
 * through unchanged.
 */
function buildAlternative(
  input: SolverInput,
  data: DataBundle,
  tierCeiling: 1 | 2 | 3,
  kind: SolverAlternativeKind,
): SolverAlternative {
  const output = computeMix(
    {
      ...input,
      tierCeiling,
    },
    data,
  );
  // Detect partial coverage from warnings. The standard-flow partial
  // signal is `Partial heal for <types> — administer this mix and re-scan`
  // (emitted when the chem pass left damage uncovered AND the cryo lane
  // didn't take it). The OD-meets-threshold warning ("split doses or
  // accept partial heal") is NOT a coverage signal — the medic accepting
  // the OD-capped dose still gets full coverage when healPerUnit × OD ≥
  // damage, so we exclude it from the regex.
  const partial =
    output.warnings.some((w) => /Partial heal for|re-scan(?!.*OD)/.test(w)) ||
    (output.solved &&
      output.ingredients.length === 0 &&
      output.physical.length === 0 &&
      output.cryo === null);
  const totalUnits = output.ingredients.reduce((s, i) => s + i.units, 0);
  return {
    kind,
    tierCeiling,
    summary: buildAlternativeSummary(kind, output, partial),
    partial,
    totalUnits,
    output,
  };
}

/**
 * True when two alternatives have identical chem ingredient sets and
 * cryo picks. Used to suppress duplicate cards (e.g. when tier-2 and
 * tier-3 produce the same Rx because no tier-3 chem won the ranking).
 */
function alternativesAreEquivalent(
  a: SolverAlternative,
  b: SolverAlternative,
): boolean {
  if (a.output.ingredients.length !== b.output.ingredients.length) return false;
  const aIds = new Map(
    a.output.ingredients.map((i) => [i.reagentId, i.units] as const),
  );
  for (const ing of b.output.ingredients) {
    if (aIds.get(ing.reagentId) !== ing.units) return false;
  }
  if ((a.output.cryo?.reagentId ?? null) !== (b.output.cryo?.reagentId ?? null))
    return false;
  return true;
}

/**
 * Public entry point for vs-xvp.5: returns a ranked list of 2-4 Rx
 * alternatives plus the index of the default-expanded card.
 *
 * Algorithm:
 *   1. Run `computeMix` with tier ceilings 1, 2, 3 (skip the
 *      `dead`-mode case — that flow has its own multi-panel layout
 *      and isn't a fit for ranked alternatives; return a single-
 *      alternative wrapper for backwards compatibility).
 *   2. Build a `SolverAlternative` per ceiling, compute trade-off
 *      summaries, mark partial-coverage entries.
 *   3. Suppress duplicate adjacent alternatives.
 *   4. Pick the default-expanded index: the lowest-tier non-partial
 *      alternative (i.e. fully covers damage). If every alternative is
 *      partial, fall back to the highest-tier (most coverage) card.
 */
export function computeAlternatives(
  input: SolverInput,
  data: DataBundle,
): SolverAlternatives {
  // Dead-mode is a different flow — skip the ceiling sweep and wrap the
  // single output as a 1-card alternative list so callers can handle it
  // uniformly.
  if (input.patientState === 'dead') {
    const output = computeMix(input, data);
    return {
      alternatives: [
        {
          kind: 'exotic-allowed',
          tierCeiling: 3,
          summary:
            'Dead-patient revival flow — topicals → defib → post-revival chems.',
          partial: false,
          totalUnits: output.ingredients.reduce((s, i) => s + i.units, 0),
          output,
        },
      ],
      defaultIndex: 0,
    };
  }

  const tier1 = buildAlternative(input, data, 1, 'fridge-stock');
  const tier2 = buildAlternative(input, data, 2, 'standard');
  const tier3 = buildAlternative(input, data, 3, 'exotic-allowed');

  // Suppress adjacent duplicates: if tier-2 picked the same chems as
  // tier-1 (because no tier-2 chem improved anything), drop tier-2.
  // Same for tier-3 vs tier-2.
  const ordered: SolverAlternative[] = [tier1];
  if (!alternativesAreEquivalent(tier1, tier2)) ordered.push(tier2);
  const lastInOrdered = ordered[ordered.length - 1];
  if (!alternativesAreEquivalent(lastInOrdered, tier3)) ordered.push(tier3);

  // Default-expanded: lowest-tier non-partial alternative. If every
  // alternative is partial (rare — usually means damage type has no
  // healer at all), fall back to the highest-tier so the medic gets the
  // most coverage available.
  let defaultIndex = ordered.findIndex((a) => !a.partial);
  if (defaultIndex === -1) defaultIndex = ordered.length - 1;

  return { alternatives: ordered, defaultIndex };
}
