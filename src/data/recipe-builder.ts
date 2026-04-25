// Recipe expansion + full-Rx synthesis order (vs-xvp.3).
//
// Given a prescribed mix (`SolverIngredient[]`), build:
//   1. A per-medicine recipe tree (raw inputs scaled to prescribed quantity,
//      with intermediate sub-steps preserved for clarity).
//   2. A combined "Full Rx" plan: dependency-ordered reaction sequence with
//      shared intermediates de-duplicated, and a flat raw-input shopping list.
//
// Tier-1 "fridge stock" reagents (per `reagent-tiers.ts`) are skipped at the
// recipe-panel level — the medic just grabs them pre-made. The Full Rx plan
// also skips synthesis steps for tier-1 outputs (e.g. Bicaridine, Saline,
// Dexalin, Hyronalin) on the assumption they're already in the fridge; their
// units are surfaced in the "fridge pulls" section instead.
//
// Quantity scaling philosophy: the canonical reaction defines a fixed unit
// ratio (e.g. "Bicaridine: Inaprovaline 1 + Carbon 1 → Bicaridine 2"). The
// medic dispenses in 5/10/15-unit chunks, so we round UP to the nearest
// canonical batch multiplier rather than producing fractional unit counts.
// A 17u prescription → ceil(17 / batch_size) batches → may overshoot, which
// is fine; the chemmaster dump-out handles leftover.

import type { Reaction, ReactionComponent } from '../types';
import { tierFor } from './reagent-tiers';
import type { DataBundle } from './store';

/**
 * Chem-dispenser raw elements. Some have producing reactions (`Oil → Fat →
 * Carbon → Oil` cycle, for instance), but a medic gets these straight from
 * the chem dispenser and we never want to recurse into those producing
 * reactions for recipe-builder purposes — both because they're trivially
 * available and because the cycle would blow the stack.
 *
 * The list is conservative — basic chem-dispenser primitives plus the
 * commonly-listed "raw" inputs (Oil/Fat/Plasma/etc.). Adding to this set
 * is a one-way street: it makes the reagent show up in the medic's
 * shopping list rather than expanding into sub-steps.
 */
const RAW_CHEMICAL_ELEMENTS: ReadonlySet<string> = new Set([
  'Hydrogen',
  'Oxygen',
  'Nitrogen',
  'Carbon',
  'Silicon',
  'Iron',
  'Copper',
  'Aluminium',
  'Sulfur',
  'Sodium',
  'Potassium',
  'Lithium',
  'Phosphorus',
  'Chlorine',
  'Fluorine',
  'Mercury',
  'Iodine',
  'Radium',
  'Plasma',
  'Water',
  'Sugar',
  'TableSalt',
  'Ethanol',
  'Ammonia',
  'WeldingFuel',
  // Botany / salvage / other "shopping list" leaves the medic gathers,
  // never synthesizes from elements:
  'Aloe',
  'CarpoToxin',
  'Blood',
  'Coffee',
  'ZombieBlood',
  // Chemistry intermediates that are technically reactions but we treat as
  // leaves to avoid runaway expansion (the medic recognizes them as their
  // own line item; the reagent detail page covers their recipe):
  'Oil',
  'Fat',
]);

/** A single sub-step in a recipe (one reaction firing, scaled). */
export interface RecipeStep {
  readonly reactionId: string;
  /** Output reagent of this step (always non-null — every reaction produces). */
  readonly outputId: string;
  /** Units of `outputId` produced by this scaled step. May exceed the requested. */
  readonly outputUnits: number;
  /** How many times this batch must be run. */
  readonly batches: number;
  /** Per-reactant units required in total (batches × per-batch amount). */
  readonly reactants: ReadonlyArray<{
    readonly id: string;
    readonly units: number;
  }>;
  /** Catalysts (unconsumed) — listed for the medic but no quantity scaling needed. */
  readonly catalysts: readonly ReactionComponent[];
  /** minTemp / maxTemp gate from the reaction (for hot-plate steps). */
  readonly minTemp: number | null;
  readonly maxTemp: number | null;
}

/** Recipe for a single prescribed reagent (recursive: steps may depend on prior). */
export interface RecipeTree {
  readonly reagentId: string;
  /** Final units of `reagentId` the medic asked for (the unrounded prescription). */
  readonly requestedUnits: number;
  /**
   * Ordered steps, dependencies-first. Each step's reactants either appear
   * earlier in the same array (intermediate produced by an earlier step) or
   * are raw inputs / fridge-stock chems.
   */
  readonly steps: readonly RecipeStep[];
  /** True when this reagent is tier 1 → no synthesis panel; just grab from fridge. */
  readonly isFridgeStock: boolean;
  /** Reagents consumed but not produced anywhere in this tree (raw inputs or fridge pulls). */
  readonly leafInputs: ReadonlyArray<{
    readonly id: string;
    readonly units: number;
  }>;
}

/** Full-Rx: combined synthesis order across the whole prescription. */
export interface FullRxPlan {
  /** Steps in dependency-correct order (de-duplicated across recipes). */
  readonly steps: readonly RecipeStep[];
  /** Raw inputs (chem dispenser elements + non-recipe sources) needed across all steps. */
  readonly rawInputs: ReadonlyArray<{
    readonly id: string;
    readonly units: number;
  }>;
  /** Tier-1 fridge pulls — the medic grabs these from the fridge; not synthesized. */
  readonly fridgePulls: ReadonlyArray<{
    readonly id: string;
    readonly units: number;
  }>;
}

/**
 * Pick the canonical reaction for a reagent. We prefer reactions with the
 * most products of the target reagent (highest yield) so the medic runs
 * fewer batches. Ties broken by reactant simplicity (fewer required inputs).
 */
function pickReaction(reagentId: string, data: DataBundle): Reaction | null {
  const candidates = data.reactionsProducing.get(reagentId);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Prefer the reaction yielding the most of `reagentId` per batch.
  let best = candidates[0];
  let bestYield = 0;
  for (const rx of candidates) {
    const out = rx.products.find((p) => p.id === reagentId);
    if (!out) continue;
    if (
      out.amount > bestYield ||
      (out.amount === bestYield && rx.reactants.length < best.reactants.length)
    ) {
      best = rx;
      bestYield = out.amount;
    }
  }
  return best;
}

/**
 * Internal recursive expansion: returns the set of steps needed to produce
 * `units` of `reagentId`, in dependency-correct order. The caller is
 * responsible for deduping across multiple top-level reagents (we don't
 * have global state here).
 *
 * `seen` tracks already-emitted step keys to avoid producing the same
 * intermediate twice within a single recipe tree.
 */
function expandRecipe(
  reagentId: string,
  units: number,
  data: DataBundle,
  steps: RecipeStep[],
  emittedFor: Set<string>,
  stopAtFridgeStock: boolean,
): void {
  // Treat raw chem-dispenser elements as leaves so we don't recurse into
  // synthesis cycles (Oil↔Fat↔Carbon).
  if (RAW_CHEMICAL_ELEMENTS.has(reagentId)) return;
  // Stop when we hit a raw input (no producing reaction) or a fridge-stock chem.
  const rx = pickReaction(reagentId, data);
  if (!rx) return;
  if (
    stopAtFridgeStock &&
    tierFor(reagentId) === 1 &&
    reagentId !== 'Inaprovaline'
  ) {
    // Fridge-stock chems are pre-made; we don't need to synthesize them.
    // (Inaprovaline is the exception — it's tier 1 but routinely needed as a
    // precursor for Bicaridine etc., so we treat it as synthesizable when
    // requested as a sub-step.)
    return;
  }
  if (emittedFor.has(reagentId)) return;
  emittedFor.add(reagentId);

  const productEntry = rx.products.find((p) => p.id === reagentId);
  if (!productEntry || productEntry.amount <= 0) return;
  const perBatch = productEntry.amount;
  const batches = Math.max(1, Math.ceil(units / perBatch));

  // Recurse into each reactant first so dependencies are emitted before the
  // step that consumes them. Catalysts aren't recursed (unconsumed).
  for (const reactant of rx.reactants) {
    const totalReactant = reactant.amount * batches;
    expandRecipe(
      reactant.id,
      totalReactant,
      data,
      steps,
      emittedFor,
      stopAtFridgeStock,
    );
  }

  steps.push({
    reactionId: rx.id,
    outputId: reagentId,
    outputUnits: perBatch * batches,
    batches,
    reactants: rx.reactants.map((r) => ({
      id: r.id,
      units: r.amount * batches,
    })),
    catalysts: rx.catalysts,
    minTemp: rx.minTemp,
    maxTemp: rx.maxTemp,
  });
}

/**
 * Build a per-medicine recipe tree. Tier-1 fridge-stock reagents return an
 * empty-steps tree (`isFridgeStock: true`) so the UI can render a
 * "grab pre-made from fridge" hint instead of a recipe block.
 */
export function buildRecipeTree(
  reagentId: string,
  units: number,
  data: DataBundle,
): RecipeTree {
  const tier = tierFor(reagentId);
  // Tier 1 chems with a producing reaction: still skip synthesis; medic
  // pulls from fridge. Tier 1 chems with NO reaction (Saline, etc.) — same.
  if (tier === 1) {
    return {
      reagentId,
      requestedUnits: units,
      steps: [],
      isFridgeStock: true,
      leafInputs: [{ id: reagentId, units }],
    };
  }
  const steps: RecipeStep[] = [];
  const emitted = new Set<string>();
  expandRecipe(reagentId, units, data, steps, emitted, true);

  // Compute leaf inputs: reactants in the step list that are NOT produced by
  // any earlier step in this tree.
  const producedHere = new Set(steps.map((s) => s.outputId));
  const leafTotals = new Map<string, number>();
  for (const s of steps) {
    for (const r of s.reactants) {
      if (producedHere.has(r.id)) continue;
      leafTotals.set(r.id, (leafTotals.get(r.id) ?? 0) + r.units);
    }
  }
  const leafInputs = [...leafTotals.entries()]
    .map(([id, u]) => ({ id, units: u }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    reagentId,
    requestedUnits: units,
    steps,
    isFridgeStock: false,
    leafInputs,
  };
}

/**
 * Build the combined "Full Rx" plan across multiple prescribed reagents.
 * Shared intermediates (e.g. Inaprovaline as precursor to Bicaridine and
 * Lacerinol) are produced ONCE at the maximum required amount and the
 * resulting step is emitted before all dependents.
 *
 * Tier-1 chems are split off into `fridgePulls` rather than synthesized.
 */
export function buildFullRxPlan(
  ingredients: ReadonlyArray<{
    readonly reagentId: string;
    readonly units: number;
  }>,
  data: DataBundle,
): FullRxPlan {
  // First pass: total units required per intermediate / output across the
  // whole prescription. Walk each top-level reagent's expansion and SUM
  // reactant requirements (so two recipes that share Inaprovaline need
  // their combined Inaprovaline at the right scale).
  const requiredUnits = new Map<string, number>();
  const fridgePulls = new Map<string, number>();

  function accumulate(
    reagentId: string,
    units: number,
    isTopLevel: boolean,
    visiting: ReadonlySet<string>,
  ): void {
    const tier = tierFor(reagentId);
    // Top-level fridge-stock chems → fridge pull, no synthesis at all.
    if (isTopLevel && tier === 1) {
      fridgePulls.set(reagentId, (fridgePulls.get(reagentId) ?? 0) + units);
      return;
    }
    // Treat raw chem-dispenser elements as leaves so we don't recurse into
    // synthesis cycles (Oil↔Fat↔Carbon).
    if (RAW_CHEMICAL_ELEMENTS.has(reagentId)) {
      requiredUnits.set(
        reagentId,
        Math.max(requiredUnits.get(reagentId) ?? 0, units),
      );
      return;
    }
    // Cycle guard: if this reagent is already on the current expansion stack,
    // treat it as a leaf to break the loop.
    if (visiting.has(reagentId)) {
      requiredUnits.set(
        reagentId,
        Math.max(requiredUnits.get(reagentId) ?? 0, units),
      );
      return;
    }
    const rx = pickReaction(reagentId, data);
    // No reaction → raw input (handled later via leaf accounting). Note: we
    // also stop here for non-top-level fridge-stock chems EXCEPT Inaprovaline,
    // matching the same logic in expandRecipe (Inaprovaline is genuinely
    // needed as a precursor and is cheap enough to remix).
    if (!rx) {
      requiredUnits.set(
        reagentId,
        Math.max(requiredUnits.get(reagentId) ?? 0, units),
      );
      return;
    }
    if (!isTopLevel && tier === 1 && reagentId !== 'Inaprovaline') {
      // Sub-recipe fridge-stock chem → fridge pull, don't recurse.
      fridgePulls.set(reagentId, (fridgePulls.get(reagentId) ?? 0) + units);
      return;
    }
    requiredUnits.set(
      reagentId,
      Math.max(requiredUnits.get(reagentId) ?? 0, units),
    );
    const productEntry = rx.products.find((p) => p.id === reagentId);
    if (!productEntry || productEntry.amount <= 0) return;
    const perBatch = productEntry.amount;
    const batches = Math.max(1, Math.ceil(units / perBatch));
    const nextVisiting = new Set(visiting);
    nextVisiting.add(reagentId);
    for (const r of rx.reactants) {
      accumulate(r.id, r.amount * batches, false, nextVisiting);
    }
  }

  for (const ing of ingredients) {
    accumulate(ing.reagentId, ing.units, true, new Set());
  }

  // Second pass: for each reagent in `requiredUnits` that has a producing
  // reaction, emit a step at the required scale. Order: dependencies first
  // (a reagent must be emitted only after all its reactants have been
  // emitted, modulo raw inputs). We do a simple topological sort over the
  // dependency graph restricted to `requiredUnits`.

  const emitted = new Set<string>();
  const steps: RecipeStep[] = [];

  function emit(reagentId: string, visiting: ReadonlySet<string>): void {
    if (emitted.has(reagentId)) return;
    if (RAW_CHEMICAL_ELEMENTS.has(reagentId)) return;
    if (visiting.has(reagentId)) return; // cycle guard
    const rx = pickReaction(reagentId, data);
    if (!rx) return; // raw input — handled in rawInputs below
    // Dependencies first.
    const nextVisiting = new Set(visiting);
    nextVisiting.add(reagentId);
    for (const r of rx.reactants) {
      if (requiredUnits.has(r.id) && !emitted.has(r.id)) {
        emit(r.id, nextVisiting);
      }
    }
    const need = requiredUnits.get(reagentId) ?? 0;
    if (need <= 0) return;
    const productEntry = rx.products.find((p) => p.id === reagentId);
    if (!productEntry || productEntry.amount <= 0) return;
    const perBatch = productEntry.amount;
    const batches = Math.max(1, Math.ceil(need / perBatch));
    steps.push({
      reactionId: rx.id,
      outputId: reagentId,
      outputUnits: perBatch * batches,
      batches,
      reactants: rx.reactants.map((r) => ({
        id: r.id,
        units: r.amount * batches,
      })),
      catalysts: rx.catalysts,
      minTemp: rx.minTemp,
      maxTemp: rx.maxTemp,
    });
    emitted.add(reagentId);
  }

  for (const reagentId of requiredUnits.keys()) {
    emit(reagentId, new Set());
  }

  // Compute raw inputs: reactants of any step that are NOT themselves emitted
  // outputs (i.e. they're the bottom of the dependency tree — chem dispenser
  // elements, table salt, etc.).
  const producedHere = new Set(steps.map((s) => s.outputId));
  const rawTotals = new Map<string, number>();
  for (const s of steps) {
    for (const r of s.reactants) {
      if (producedHere.has(r.id)) continue;
      // Tier-1 fridge-stock chems used as sub-step reactants are routed to
      // fridgePulls in `accumulate` already; here we just guard against
      // them slipping into rawTotals if accumulate missed (e.g. Inaprovaline
      // explicitly handled as synthesizable, so it's a producedHere).
      if (fridgePulls.has(r.id)) continue;
      rawTotals.set(r.id, (rawTotals.get(r.id) ?? 0) + r.units);
    }
  }

  const rawInputs = [...rawTotals.entries()]
    .map(([id, u]) => ({ id, units: u }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const fridge = [...fridgePulls.entries()]
    .map(([id, u]) => ({ id, units: u }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { steps, rawInputs, fridgePulls: fridge };
}
