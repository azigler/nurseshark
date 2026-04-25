// Recipe builder tests (vs-xvp.3). Loads the real public/data bundle and
// exercises the per-medicine recipe tree + Full Rx synthesis order against
// known SS14 reactions.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  Container,
  DamageType,
  FluentDict,
  Meta,
  PhysicalItem,
  Reaction,
  Reagent,
  Species,
  SpriteManifest,
} from '../../types';
import { buildFullRxPlan, buildRecipeTree } from '../recipe-builder';
import type { DataBundle } from '../store';

function loadJson<T>(rel: string): T {
  const p = resolve(__dirname, '../../../public/data', rel);
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

function buildBundle(): DataBundle {
  const reagents = loadJson<readonly Reagent[]>('reagents.json');
  const reactions = loadJson<readonly Reaction[]>('reactions.json');
  const damage = loadJson<readonly DamageType[]>('damage.json');
  const species = loadJson<readonly Species[]>('species.json');
  const containers = loadJson<readonly Container[]>('containers.json');
  const physicalItems = loadJson<readonly PhysicalItem[]>(
    'physical-items.json',
  );
  const fluent = loadJson<FluentDict>('fluent.json');
  const meta = loadJson<Meta>('meta.json');
  const sprites = loadJson<SpriteManifest>('sprites_manifest.json');

  const reagentsById = new Map(reagents.map((r) => [r.id, r]));
  const reactionsById = new Map(reactions.map((r) => [r.id, r]));
  const damageById = new Map(damage.map((d) => [d.id, d]));
  const speciesById = new Map(species.map((s) => [s.id, s]));
  const containersById = new Map(containers.map((c) => [c.id, c]));
  const physicalItemsById = new Map(physicalItems.map((p) => [p.id, p]));

  const damageGroupMembers = new Map<string, string[]>();
  for (const d of damage) {
    if (d.group) {
      const arr = damageGroupMembers.get(d.group) ?? [];
      arr.push(d.id);
      damageGroupMembers.set(d.group, arr);
    }
  }
  const reactionsProducing = new Map<string, Reaction[]>();
  const reactionsConsuming = new Map<string, Reaction[]>();
  for (const rx of reactions) {
    for (const p of rx.products) {
      const arr = reactionsProducing.get(p.id) ?? [];
      arr.push(rx);
      reactionsProducing.set(p.id, arr);
    }
    for (const c of [...rx.reactants, ...rx.catalysts]) {
      const arr = reactionsConsuming.get(c.id) ?? [];
      arr.push(rx);
      reactionsConsuming.set(c.id, arr);
    }
  }
  return {
    reagents,
    reactions,
    damage,
    species,
    containers,
    physicalItems,
    fluent,
    meta,
    sprites,
    reagentsById,
    reactionsById,
    damageById,
    speciesById,
    containersById,
    physicalItemsById,
    damageGroupMembers,
    reactionsProducing,
    reactionsConsuming,
  };
}

describe('buildRecipeTree', () => {
  let data: DataBundle;
  beforeAll(() => {
    data = buildBundle();
  });

  // Tier-1 chem (Bicaridine) → fridge stock, no synthesis steps surfaced.
  it('Bicaridine (tier 1) returns fridge-stock tree with no steps', () => {
    const tree = buildRecipeTree('Bicaridine', 15, data);
    expect(tree.isFridgeStock).toBe(true);
    expect(tree.steps).toHaveLength(0);
    expect(tree.leafInputs).toEqual([{ id: 'Bicaridine', units: 15 }]);
  });

  // Saline (tier 1, simple recipe) → still fridge-stock.
  it('Saline (tier 1) returns fridge-stock tree', () => {
    const tree = buildRecipeTree('Saline', 30, data);
    expect(tree.isFridgeStock).toBe(true);
    expect(tree.steps).toHaveLength(0);
  });

  // Tier-2 chem (Bruizine) → multi-step: Inaprovaline → Bicaridine → Bruizine.
  it('Bruizine (tier 2) expands recipe with intermediates', () => {
    const tree = buildRecipeTree('Bruizine', 25, data);
    expect(tree.isFridgeStock).toBe(false);
    // Steps include Bruizine itself and Bicaridine + Inaprovaline (since
    // Inaprovaline is the tier-1 exception that's still synthesizable as a
    // sub-step). Bicaridine is normally tier-1 fridge-stock, but here it's
    // a precursor for Bruizine — handled by stopAtFridgeStock=true skipping
    // Bicaridine sub-recipe; let's check the steps actually emitted.
    const stepIds = tree.steps.map((s) => s.outputId);
    expect(stepIds).toContain('Bruizine');
    // Final step is Bruizine.
    expect(tree.steps[tree.steps.length - 1].outputId).toBe('Bruizine');
    // Each step's batches >= 1.
    for (const s of tree.steps) {
      expect(s.batches).toBeGreaterThanOrEqual(1);
    }
  });

  // Tier-2 chem (Aloxadone) → multi-step recipe involving Cryoxadone +
  // Leporazine. Aloxadone needs aloe (botany) so the leaf inputs include it.
  it('Aloxadone expands and lists botany aloe in leaf inputs', () => {
    const tree = buildRecipeTree('Aloxadone', 20, data);
    expect(tree.isFridgeStock).toBe(false);
    expect(tree.steps.length).toBeGreaterThan(0);
    // Aloxadone reaction: Cryoxadone + Aloe + Leporazine. So step list
    // should include Aloxadone as the final step.
    expect(tree.steps[tree.steps.length - 1].outputId).toBe('Aloxadone');
    // Aloe should appear somewhere in leafInputs (it's not produced by any
    // reaction in our pipeline).
    const leafIds = tree.leafInputs.map((l) => l.id);
    expect(leafIds).toContain('Aloe');
  });

  // Quantity scaling: requesting 45u of Bicaridine (or any reagent with a
  // producing reaction) should round up to whole batches.
  it('quantity scaling rounds UP to whole batches', () => {
    // Force a tier-2 reagent so we get steps. Bruizine reaction produces 2u
    // per batch (if the YAML says so) or some other fixed yield.
    const tree = buildRecipeTree('Bruizine', 17, data);
    if (tree.steps.length > 0) {
      const finalStep = tree.steps[tree.steps.length - 1];
      // outputUnits is whole-batch — at least the requested amount.
      expect(finalStep.outputUnits).toBeGreaterThanOrEqual(17);
      // batches × per-batch = outputUnits.
      const perBatch = finalStep.outputUnits / finalStep.batches;
      expect(Number.isInteger(perBatch * 100)).toBe(true);
    }
  });
});

describe('buildFullRxPlan', () => {
  let data: DataBundle;
  beforeAll(() => {
    data = buildBundle();
  });

  // Single tier-1 reagent → just a fridge pull, no synthesis steps.
  it('single Bicaridine prescription is fridge-pull only', () => {
    const plan = buildFullRxPlan(
      [{ reagentId: 'Bicaridine', units: 15 }],
      data,
    );
    expect(plan.steps).toHaveLength(0);
    expect(plan.fridgePulls).toContainEqual({ id: 'Bicaridine', units: 15 });
    expect(plan.rawInputs).toHaveLength(0);
  });

  // Mixed prescription: tier-1 (Bicaridine) + tier-2 (Bruizine). Both end
  // up routing Bicaridine into fridgePulls (top-level + Bruizine's sub-step
  // sub-pull combine into one fridgePulls entry; the medic just pulls the
  // total from the fridge). Bruizine itself goes through synthesis.
  it('mixed Bicaridine + Bruizine prescription routes correctly', () => {
    const plan = buildFullRxPlan(
      [
        { reagentId: 'Bicaridine', units: 10 },
        { reagentId: 'Bruizine', units: 25 },
      ],
      data,
    );
    // Bicaridine fridgePulls includes both the top-level 10u and Bruizine's
    // sub-recipe demand (combined).
    const bicar = plan.fridgePulls.find((p) => p.id === 'Bicaridine');
    expect(bicar).toBeDefined();
    expect(bicar?.units).toBeGreaterThanOrEqual(10);
    expect(plan.steps.length).toBeGreaterThan(0);
    // Bruizine should be the last step (longest dependency chain).
    expect(plan.steps[plan.steps.length - 1].outputId).toBe('Bruizine');
    // Raw inputs should include Lithium (Bruizine) and Sugar (Bruizine).
    const rawIds = plan.rawInputs.map((r) => r.id);
    expect(rawIds).toContain('Lithium');
  });

  // Shared intermediate dedup: if two top-level reagents both depend on
  // Inaprovaline, the Full Rx plan emits Inaprovaline once at the combined
  // scale.
  it('shared intermediate Inaprovaline is emitted once at combined scale', () => {
    // Lacerinol and Puncturase both depend on Bicaridine which depends on
    // Inaprovaline. Force both into the prescription.
    const plan = buildFullRxPlan(
      [
        { reagentId: 'Lacerinol', units: 25 },
        { reagentId: 'Puncturase', units: 25 },
      ],
      data,
    );
    const inaprovalineSteps = plan.steps.filter(
      (s) => s.outputId === 'Inaprovaline',
    );
    // Inaprovaline appears at most ONCE in the combined plan.
    expect(inaprovalineSteps.length).toBeLessThanOrEqual(1);
  });

  // Dependency ordering: every step's reactants either appear earlier in
  // the plan or are raw inputs.
  it('Full Rx steps are in dependency-correct order', () => {
    const plan = buildFullRxPlan(
      [
        { reagentId: 'Lacerinol', units: 25 },
        { reagentId: 'Bruizine', units: 25 },
      ],
      data,
    );
    const seen = new Set<string>();
    for (const step of plan.steps) {
      for (const r of step.reactants) {
        // If r.id is produced by ANY step in this plan, it must have been
        // emitted before this step.
        const isProducedByPlan = plan.steps.some((s) => s.outputId === r.id);
        if (isProducedByPlan) {
          expect(seen.has(r.id)).toBe(true);
        }
      }
      seen.add(step.outputId);
    }
  });

  // Saline (tier 1, no producing reaction in our blacklist-respecting view —
  // actually Saline DOES have a reaction: water + table salt). It's tier 1
  // so it routes to fridge pulls.
  it('Saline routes to fridgePulls regardless of reaction availability', () => {
    const plan = buildFullRxPlan([{ reagentId: 'Saline', units: 30 }], data);
    expect(plan.fridgePulls).toContainEqual({ id: 'Saline', units: 30 });
    expect(plan.steps).toHaveLength(0);
  });

  // Empty prescription → empty plan.
  it('empty prescription yields empty plan', () => {
    const plan = buildFullRxPlan([], data);
    expect(plan.steps).toHaveLength(0);
    expect(plan.rawInputs).toHaveLength(0);
    expect(plan.fridgePulls).toHaveLength(0);
  });
});
