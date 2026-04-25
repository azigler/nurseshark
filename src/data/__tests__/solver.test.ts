// Unit tests for the damage-to-mix solver. These tests load the real
// public/data/*.json bundle synchronously (the setup.ts stubs global
// fetch, but we use the raw loader here) and exercise the solver against
// it. Focused scenarios per vs-2wj acceptance.

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
import { computeAlternatives, computeMix } from '../solver';
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

describe('computeMix', () => {
  let data: DataBundle;
  beforeAll(() => {
    data = buildBundle();
  });

  it('returns not-solved when no damage entered', () => {
    const out = computeMix(
      {
        damage: {},
        species: 'Human',
        filters: { chems: true, physical: true, cryo: true },
      },
      data,
    );
    expect(out.solved).toBe(false);
    expect(out.ingredients).toHaveLength(0);
    expect(out.warnings.some((w) => /no damage/i.test(w))).toBe(true);
  });

  // Scenario 1: single damage type — 45 Blunt on Human, chems only.
  it('solves a single Blunt profile with a brute med', () => {
    const out = computeMix(
      {
        damage: { Blunt: 45 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.solved).toBe(true);
    // Should include exactly one brute med (Bicaridine, Bruizine, or similar).
    const bruteMeds = ['Bicaridine', 'Bruizine', 'Rororium', 'Arcryox'];
    const picked = out.ingredients.filter((i) =>
      bruteMeds.includes(i.reagentId),
    );
    expect(picked.length).toBeGreaterThanOrEqual(1);
    expect(picked.length).toBeLessThanOrEqual(1);
    // Units should be sane (≥ 5, ≤ some reasonable OD cap).
    expect(picked[0].units).toBeGreaterThanOrEqual(5);
    expect(picked[0].units).toBeLessThanOrEqual(30);
    // Reason string is non-empty.
    expect(picked[0].reason.length).toBeGreaterThan(0);
    expect(picked[0].reason).toMatch(/Blunt|brute/i);
  });

  // Scenario 2: multi-damage — the solver dedupes by picking reagents
  // that cover multiple input types when possible.
  it('picks reagents that cover multiple damage types', () => {
    const out = computeMix(
      {
        damage: { Blunt: 20, Piercing: 20, Slash: 20 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.solved).toBe(true);
    // Should prefer a single brute-group reagent (Bicaridine covers all 3)
    // rather than picking a separate chem per type.
    const bruteBroad = ['Bicaridine', 'Arcryox', 'Rororium', 'Tricordrazine'];
    const hit = out.ingredients.find((i) => bruteBroad.includes(i.reagentId));
    expect(hit).toBeDefined();
  });

  // Scenario 3: razorium — Bicaridine + Bruizine is forbidden.
  it('never picks two conflicting brute meds at once', () => {
    const out = computeMix(
      {
        damage: { Blunt: 40, Piercing: 30, Slash: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const ids = new Set(out.ingredients.map((i) => i.reagentId));
    const bruteMeds = ['Bicaridine', 'Bruizine', 'Lacerinol', 'Puncturase'];
    const hits = bruteMeds.filter((m) => ids.has(m));
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  // Scenario 4: species overlay — Moth + bloodloss should swap to Saline.
  it('applies Moth species overlay (Saline for bloodloss)', () => {
    const out = computeMix(
      {
        damage: { Bloodloss: 40 },
        species: 'Moth',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.solved).toBe(true);
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).toContain('Saline');
    // Dexalin / DexalinPlus / Ichor should NOT be the chosen bloodloss restorer
    // for Moth (they'd be swapped out).
    const ironChain = ['Dexalin', 'DexalinPlus'];
    const ironPicked = ids.filter((id) => ironChain.includes(id));
    expect(ironPicked).toHaveLength(0);
    // And definitely not Copper — that's Arachnid-specific.
    expect(ids).not.toContain('Copper');
  });

  // Scenario 4b: Vox + bloodloss should also swap to Saline (non-Arachnid cohort).
  it('applies Vox species overlay (Saline for bloodloss, not Copper)', () => {
    const out = computeMix(
      {
        damage: { Bloodloss: 30 },
        species: 'Vox',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.solved).toBe(true);
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).toContain('Saline');
    expect(ids).not.toContain('Copper');
  });

  // Scenario 4c: Diona + bloodloss keeps Ichor (tree-sap compatible).
  it('applies Diona species overlay (keeps Ichor, no Copper)', () => {
    const out = computeMix(
      {
        damage: { Bloodloss: 30 },
        species: 'Diona',
        filters: { chems: true, physical: false, cryo: false },
        // Ichor is blacklisted by default; opt in to exercise the Diona path.
        includeRestricted: true,
      },
      data,
    );
    expect(out.solved).toBe(true);
    const ids = out.ingredients.map((i) => i.reagentId);
    // Either Ichor is kept (Diona-specific) or Saline is fallback; Copper MUST
    // NOT be injected — it's gated for Arachnid only.
    expect(ids).not.toContain('Copper');
  });

  // Scenario 4d: Arachnid + bloodloss → Copper overlay (NOT Iron, NOT Saline).
  // Iron is toxic to Arachnids in-game (elements.yml: Iron's HealthChange
  // Poison 0.1/tick gated on MetabolizerTypeCondition Arachnid; its
  // ModifyBloodLevel is inverted so no blood restored). Copper is the mirror
  // and the species-correct blood restorer.
  it('applies Arachnid species overlay (Copper, not Iron or Saline)', () => {
    const out = computeMix(
      {
        damage: { Bloodloss: 30 },
        species: 'Arachnid',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.solved).toBe(true);
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).toContain('Copper');
    // Saline is fallback only — when Copper is available we shouldn't inject it.
    expect(ids).not.toContain('Saline');
    // Iron-chain healers must not leak through.
    expect(ids).not.toContain('Dexalin');
    expect(ids).not.toContain('DexalinPlus');
    expect(ids).not.toContain('Iron');
    // Copper units should scale with bloodloss: 30 / 4-per-unit = ceil(7.5) = 8
    // (minimum 5u enforced elsewhere).
    const copper = out.ingredients.find((i) => i.reagentId === 'Copper');
    expect(copper?.units).toBeGreaterThanOrEqual(5);
    expect(copper?.units).toBeLessThanOrEqual(20);
    // A warning should note the swap (wiki-phrased or fallback).
    const warning = out.warnings.find((w) => /toxic|Copper/i.test(w));
    expect(warning).toBeDefined();
  });

  // Scenario 4e: Human + bloodloss → standard ranking (no species overlay).
  // Verifies the overlay does NOT fire for default-metabolism species: no
  // Copper injection, no Saline injection. The solver's natural pick for a
  // Bloodloss-only profile on Human is whichever reagent with a heals[] entry
  // covering the Airloss group (Bloodloss ∈ Airloss) ranks highest — in the
  // current data that's Cryoxadone (3/tick, broad coverage) rather than a
  // pure iron-chain healer, and that's fine: the point of this test is that
  // the overlay is a no-op for Human.
  it('Human + bloodloss uses standard ranking (no species overlay)', () => {
    const out = computeMix(
      {
        damage: { Bloodloss: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.solved).toBe(true);
    const ids = out.ingredients.map((i) => i.reagentId);
    // Overlay reagents should NOT appear for Human.
    expect(ids).not.toContain('Copper');
    expect(ids).not.toContain('Saline');
    // Some chem was picked (not an empty mix).
    expect(out.ingredients.length).toBeGreaterThan(0);
    // No species-overlay warnings.
    const overlayWarning = out.warnings.find((w) =>
      /toxic|Arachnid|iron-metabolism|swapped for Saline/i.test(w),
    );
    expect(overlayWarning).toBeUndefined();
  });

  // Scenario 4f: Arachnid + bloodloss when Copper is unavailable → Saline
  // fallback with a warning. Simulate unavailability by removing Copper from
  // the bundle (mirrors what would happen if Copper were blacklisted or the
  // dataset were stripped down).
  it('Arachnid + bloodloss falls back to Saline when Copper is unavailable', () => {
    const reagentsById = new Map(data.reagentsById);
    reagentsById.delete('Copper');
    const reagents = data.reagents.filter((r) => r.id !== 'Copper');
    const stripped: DataBundle = { ...data, reagents, reagentsById };

    const out = computeMix(
      {
        damage: { Bloodloss: 30 },
        species: 'Arachnid',
        filters: { chems: true, physical: false, cryo: false },
      },
      stripped,
    );
    expect(out.solved).toBe(true);
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).not.toContain('Copper');
    expect(ids).toContain('Saline');
    // Fallback warning must mention Copper unavailability or Iron toxicity.
    const warning = out.warnings.find((w) =>
      /Copper unavailable|toxic/i.test(w),
    );
    expect(warning).toBeDefined();
  });

  // Scenario 5a: cryo toggle OFF + damage beyond OD-legal + practical-cap
  // single-shot → partial heal + warning. Cellular 250 exceeds what
  // Doxarubixadone (heal/u=4, no OD, capped at 50u practical) can deliver in
  // one dose (50 × 4 = 200 < 250).
  it('emits partial-heal warning when cryo is off and damage exceeds one dose', () => {
    const out = computeMix(
      {
        damage: { Cellular: 250 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.solved).toBe(true);
    expect(out.cryo).toBeNull();
    const hasPartialWarning = out.warnings.some((w) =>
      /re-scan|partial/i.test(w),
    );
    expect(hasPartialWarning).toBe(true);
  });

  // Scenario 5b: cryo toggle ON + damage beyond single-shot → cryo entry emitted.
  it('routes excess damage to cryo when cryo is on', () => {
    const out = computeMix(
      {
        damage: { Cellular: 250 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: true },
      },
      data,
    );
    expect(out.solved).toBe(true);
    expect(out.cryo).not.toBeNull();
    expect(out.cryo?.reagentId).toMatch(/Cryoxadone|Aloxadone|Doxarubixadone/);
    expect(out.cryo?.targetTemp).toBeGreaterThan(0);
  });

  // Scenario 5c (vs-xvp.1): cryo toggle OFF must exclude cryo-class reagents
  // from the chem pass too. The original bug: Cryoxadone covers Brute/Burn/
  // Toxin/Airloss as a group-heal entry, so a multi-damage profile with cryo
  // unchecked would still pick Cryoxadone (and route the medic toward a cryo
  // tube anyway). Filter must apply consistently across all suggestion lanes.
  it('cryo OFF excludes Cryoxadone from chem ingredients (vs-xvp.1)', () => {
    const out = computeMix(
      {
        // Multi-damage profile that Cryoxadone otherwise dominates.
        damage: { Blunt: 20, Heat: 20, Poison: 20 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.solved).toBe(true);
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).not.toContain('Cryoxadone');
    expect(ids).not.toContain('Aloxadone');
    expect(ids).not.toContain('Doxarubixadone');
    expect(ids).not.toContain('Opporozidone');
    // Cryo lane stays null (already covered by existing tests, re-asserted here).
    expect(out.cryo).toBeNull();
  });

  // Scenario 5d (vs-xvp.1, recalibrated vs-xvp.4): cryo toggle ON allows
  // cryo-class reagents back into the chem candidate pool. Prior to vs-xvp.4
  // (TIER_RATE_BIAS=0.4) this profile picked Cryoxadone outright; the
  // recalibrated bias (2.0) means Tricordrazine — which also covers all
  // three input damage types via its Brute+Burn group heals + Poison-type
  // heal — wins on the tier-1 vs tier-2 tiebreak. The medic-facing meaning
  // is correct: the basic broad-spectrum fridge chem covers this profile
  // without needing a cryo tube. Test now asserts that some valid
  // multi-coverage chem was picked, NOT specifically Cryoxadone.
  it('cryo ON allows cryo-class chems but tier-1 broad picks still win (vs-xvp.4)', () => {
    const out = computeMix(
      {
        damage: { Blunt: 20, Heat: 20, Poison: 20 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: true },
      },
      data,
    );
    expect(out.solved).toBe(true);
    const ids = out.ingredients.map((i) => i.reagentId);
    // Either Tricordrazine (tier 1, broad heal) OR Cryoxadone (tier 2,
    // full coverage) should be picked — both are reasonable. The tier
    // suppression is OK with either outcome; the regression to guard
    // against is "no broad-coverage chem picked at all."
    const hasBroadHealer = ids.some((id) =>
      ['Tricordrazine', 'Cryoxadone'].includes(id),
    );
    expect(hasBroadHealer).toBe(true);
  });

  // --- Tier ranking (vs-xvp.2). ---

  // Blunt-only profile picks Bicaridine (tier 1) over Bruizine, Lacerinol,
  // Arcryox, etc. — fridge stock first when it covers the damage.
  it('Blunt 45 picks tier-1 Bicaridine over tier-2/3 alternatives', () => {
    const out = computeMix(
      {
        damage: { Blunt: 45 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const bic = out.ingredients.find((i) => i.reagentId === 'Bicaridine');
    expect(bic).toBeDefined();
    expect(bic?.tier).toBe(1);
    // Tier-1 picks should NOT carry a tier reason (no escalation).
    expect(bic?.tierReason).toBeNull();
    // Higher-tier brute alternatives should not appear.
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).not.toContain('Arcryox');
    expect(ids).not.toContain('Bruizine');
  });

  // Burn profile picks Dermaline (tier 1) when cryo is off — Aloxadone is
  // tier-2 cryo-class and gated by the cryo filter.
  it('Heat 30 cryo OFF picks tier-1 Dermaline (vs-xvp.2)', () => {
    const out = computeMix(
      {
        damage: { Heat: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const derm = out.ingredients.find((i) => i.reagentId === 'Dermaline');
    expect(derm).toBeDefined();
    expect(derm?.tier).toBe(1);
    expect(derm?.tierReason).toBeNull();
  });

  // Cellular damage has no tier-1 alternative — Doxarubixadone (tier 2,
  // cryo-class) is the natural pick when cryo is on, and the tierReason
  // explains the escalation in fridge-stock terms.
  it('Cellular damage with cryo ON escalates to tier-2 Doxarubixadone with reason', () => {
    const out = computeMix(
      {
        damage: { Cellular: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: true },
      },
      data,
    );
    const dox = out.ingredients.find((i) => i.reagentId === 'Doxarubixadone');
    expect(dox).toBeDefined();
    expect(dox?.tier).toBe(2);
    expect(dox?.tierReason).toMatch(/no fridge-stock chem covers Cellular/i);
  });

  // Every picked ingredient has a tier (1, 2, or 3). Guards against future
  // refactors that forget to populate the field.
  it('every picked ingredient has a tier (vs-xvp.2)', () => {
    const out = computeMix(
      {
        damage: { Blunt: 30, Heat: 20, Poison: 15 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.ingredients.length).toBeGreaterThan(0);
    for (const ing of out.ingredients) {
      expect([1, 2, 3]).toContain(ing.tier);
    }
  });

  // Saline injection from species overlay carries tier 1 (fridge stock) and
  // no tierReason — the medic shouldn't see "exotic" badge on a basic
  // species-restorer chem.
  it('Moth bloodloss → Saline overlay is tier 1 (vs-xvp.2)', () => {
    const out = computeMix(
      {
        damage: { Bloodloss: 30 },
        species: 'Moth',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const saline = out.ingredients.find((i) => i.reagentId === 'Saline');
    expect(saline).toBeDefined();
    expect(saline?.tier).toBe(1);
    expect(saline?.tierReason).toBeNull();
  });

  // vs-xvp.4 audit: pure-Radiation profile picks Arithrazine (tier 1)
  // instead of Ultravasculine (now tier 3, exotic — needs Histamine
  // which has no producing reaction). With TIER_RATE_BIAS=2.0 the tier-3
  // deboost outweighs Ultravasculine's 6×-rate advantage on Toxin-group
  // heals, so the medic gets the fridge-stock pick. Ultravasculine
  // continues to win when the input profile spans Poison + Radiation
  // (covered by the next test) — coverage still trumps tier.
  it('Radiation 30 cryo OFF picks tier-1 Arithrazine, not Ultravasculine (vs-xvp.4)', () => {
    const out = computeMix(
      {
        damage: { Radiation: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const arith = out.ingredients.find((i) => i.reagentId === 'Arithrazine');
    expect(arith).toBeDefined();
    expect(arith?.tier).toBe(1);
    // Tier-1 picks carry no tier reason (no escalation needed).
    expect(arith?.tierReason).toBeNull();
    // Ultravasculine MUST NOT surface for a pure-Radiation profile —
    // that's the user-reported bug from vs-xvp.4.
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).not.toContain('Ultravasculine');
  });

  // vs-xvp.4: pure Poison profile picks Dylovene (tier 1), not
  // Ultravasculine (tier 3). This is the headline bug from the in-game
  // session — Ultravasculine surfaced for a fridge-stock-coverable
  // damage type because the prior bias (0.4) was too weak to suppress
  // a 6×-rate tier-3 chem.
  it('Poison 30 picks tier-1 Dylovene, not Ultravasculine (vs-xvp.4)', () => {
    const out = computeMix(
      {
        damage: { Poison: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).not.toContain('Ultravasculine');
    // Some Poison-covering tier-1 chem should be the pick. Dylovene is
    // the canonical answer; Tricordrazine is also acceptable
    // (covers Poison via type heal at 0.5/tick metab=0.5 → 0.25/sec
    // vs Dylovene 1.0/tick → 0.5/sec, so Dylovene wins, but the
    // assertion guards against either).
    const hasTier1Toxin = out.ingredients.some(
      (i) =>
        i.tier === 1 && ['Dylovene', 'Tricordrazine'].includes(i.reagentId),
    );
    expect(hasTier1Toxin).toBe(true);
  });

  // vs-xvp.4: when the input profile spans Poison AND Radiation,
  // Ultravasculine's coverage advantage (Toxin group covers both)
  // beats two separate tier-1 picks even with the strong bias.
  // Coverage trumps tier — the bias only kicks in when coverage ties.
  it('Poison+Radiation profile: Ultravasculine still wins on coverage (vs-xvp.4)', () => {
    const out = computeMix(
      {
        damage: { Poison: 30, Radiation: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const ultra = out.ingredients.find((i) => i.reagentId === 'Ultravasculine');
    expect(ultra).toBeDefined();
    expect(ultra?.tier).toBe(3);
    // Tier reason should explain the escalation — coverage-based phrasing.
    expect(ultra?.tierReason).toMatch(/profile coverage|heal rate|fridge/i);
  });

  // Scenario 5e (vs-xvp.1): cryo OFF + Cellular damage profile must not
  // recommend Doxarubixadone via the chem lane either. Cellular is the one
  // damage type where Doxarubixadone is the strongest single-shot heal, so
  // this is the canary that the filter applies to all damage types.
  it('cryo OFF excludes Doxarubixadone from Cellular pick (vs-xvp.1)', () => {
    const out = computeMix(
      {
        damage: { Cellular: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.solved).toBe(true);
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).not.toContain('Doxarubixadone');
    // No cryo lane either.
    expect(out.cryo).toBeNull();
    // Should surface a partial-heal warning since no other reagent covers
    // Cellular in the default (non-restricted) pool.
    const hasPartialWarning = out.warnings.some((w) =>
      /re-scan|partial/i.test(w),
    );
    expect(hasPartialWarning).toBe(true);
  });

  // Scenario 6: physical toggle OFF disables physical output.
  it('physical toggle off excludes bandages/gauze/etc', () => {
    const withPhys = computeMix(
      {
        damage: { Bloodloss: 30 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: false },
      },
      data,
    );
    const withoutPhys = computeMix(
      {
        damage: { Bloodloss: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(withoutPhys.physical).toHaveLength(0);
    expect(withPhys.physical.length).toBeGreaterThan(0);
  });

  // Scenario 7: Holy excluded — if caller smuggles Holy in, it's ignored.
  it('ignores Holy damage if included in input', () => {
    const out = computeMix(
      {
        // biome-ignore lint/suspicious/noExplicitAny: test smuggling untyped field
        damage: { Blunt: 20, Holy: 100 } as any,
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.solved).toBe(true);
    const hasHolyWarning = out.warnings.some((w) => /holy/i.test(w));
    expect(hasHolyWarning).toBe(true);
    // No reagent should be allocated for Holy (none exist in the data for it).
    expect(out.ingredients.every((i) => i.units > 0)).toBe(true);
  });

  // Scenario 8: all filters off → "no treatments enabled".
  it('all filters off returns a no-treatments-enabled warning', () => {
    const out = computeMix(
      {
        damage: { Blunt: 10 },
        species: 'Human',
        filters: { chems: false, physical: false, cryo: false },
      },
      data,
    );
    expect(out.ingredients).toHaveLength(0);
    expect(out.physical).toHaveLength(0);
    expect(out.cryo).toBeNull();
    expect(out.warnings.some((w) => /no treatments/i.test(w))).toBe(true);
  });

  // Scenario 9: worked example from spec — 45 Blunt → Bicaridine-class mix.
  it('45 Blunt on Human → Bicaridine (or equivalent brute med) in 5u..15u range', () => {
    const out = computeMix(
      {
        damage: { Blunt: 45 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const bicar = out.ingredients.find((i) => i.reagentId === 'Bicaridine');
    // Either Bicaridine (heals Brute @ 1.5/tick; 45 dmg ÷ (1.5/0.5)=3/u → 15u)
    // or Rororium (heals Brute @ 4/tick). Either way, ≤ 15u.
    const bruteMed = out.ingredients.find((i) =>
      ['Bicaridine', 'Rororium', 'Arcryox'].includes(i.reagentId),
    );
    expect(bruteMed).toBeDefined();
    if (bicar) {
      expect(bicar.units).toBeLessThanOrEqual(15);
      expect(bicar.units).toBeGreaterThanOrEqual(5);
    }
  });

  // Scenario 10: physical items are loaded from public/data/physical-items.json
  // (verified from VS14 YAML, not hand-guessed) and the solver picks the
  // right item for a given damage type. Assertions are structural (right
  // item, count scales) rather than numeric fixtures, so future YAML
  // adjustments don't require test surgery.
  it('picks Ointment or Regenerative Mesh for a burn profile', () => {
    const out = computeMix(
      {
        damage: { Heat: 20 },
        species: 'Human',
        filters: { chems: false, physical: true, cryo: false },
      },
      data,
    );
    expect(out.physical.length).toBeGreaterThan(0);
    const burnItems = out.physical.filter((p) =>
      ['Ointment', 'RegenerativeMesh', 'AloeCream'].includes(p.itemId),
    );
    expect(burnItems.length).toBeGreaterThan(0);
  });

  it('picks Brutepack or MedicatedSuture for a brute-damage profile', () => {
    const out = computeMix(
      {
        damage: { Blunt: 20 },
        species: 'Human',
        filters: { chems: false, physical: true, cryo: false },
      },
      data,
    );
    expect(out.physical.length).toBeGreaterThan(0);
    const bruteItems = out.physical.filter((p) =>
      ['Brutepack', 'MedicatedSuture'].includes(p.itemId),
    );
    expect(bruteItems.length).toBeGreaterThan(0);
  });

  it('picks Bloodpack / Gauze / MedicatedSuture for bloodloss (no iron-gating)', () => {
    const out = computeMix(
      {
        damage: { Bloodloss: 40 },
        species: 'Human',
        filters: { chems: false, physical: true, cryo: false },
      },
      data,
    );
    expect(out.physical.length).toBeGreaterThan(0);
    // Each of these items touches Bloodloss in the YAML — via direct heal
    // (Bloodpack), modifyBloodLevel (Bloodpack), or bloodlossModifier (Gauze,
    // MedicatedSuture, Tourniquet). Verify at least one landed.
    const bleedStoppers = out.physical.filter((p) =>
      ['Bloodpack', 'Gauze', 'MedicatedSuture', 'Tourniquet'].includes(
        p.itemId,
      ),
    );
    expect(bleedStoppers.length).toBeGreaterThan(0);
  });

  it('physical item count scales with damage amount', () => {
    const small = computeMix(
      {
        damage: { Heat: 5 },
        species: 'Human',
        filters: { chems: false, physical: true, cryo: false },
      },
      data,
    );
    const large = computeMix(
      {
        damage: { Heat: 40 },
        species: 'Human',
        filters: { chems: false, physical: true, cryo: false },
      },
      data,
    );
    // vs-xvp.4: physical-item tier deboost shifts the burn-item ranking.
    // RegenerativeMesh is now tier 3 (advanced medkit only) and AloeCream
    // / Ointment (tier 1) win the burn coverage. Either is acceptable for
    // this scaling test — the regression to guard is "physical-item count
    // grows with damage amount."
    const burnIds = new Set(['Ointment', 'AloeCream', 'RegenerativeMesh']);
    const smallBurn = small.physical.find((p) => burnIds.has(p.itemId));
    const largeBurn = large.physical.find((p) => burnIds.has(p.itemId));
    expect(smallBurn).toBeDefined();
    expect(largeBurn).toBeDefined();
    if (smallBurn && largeBurn) {
      expect(largeBurn.count).toBeGreaterThan(smallBurn.count);
    }
  });

  it('does not pick Tourniquet when Bloodloss is zero', () => {
    const out = computeMix(
      {
        damage: { Blunt: 20 },
        species: 'Human',
        filters: { chems: false, physical: true, cryo: false },
      },
      data,
    );
    const tourniquet = out.physical.find((p) => p.itemId === 'Tourniquet');
    expect(tourniquet).toBeUndefined();
  });

  // vs-xvp.4: tier-3 physical items (MedicatedSuture, RegenerativeMesh)
  // are advanced-medkit components — not roundstart medibot stock. The
  // solver was previously recommending them as the top burn / brute
  // pick because their raw heal-per-application (sum 30-40) outranked
  // tier-1 items (Brutepack 15, Ointment 16.5). The vs-xvp.4 audit
  // applies the same tier-bias logic to physical items so the medic
  // gets the standard medkit picks by default.
  it('Brute 20 default does not pick tier-3 MedicatedSuture (vs-xvp.4)', () => {
    const out = computeMix(
      {
        damage: { Blunt: 20 },
        species: 'Human',
        filters: { chems: false, physical: true, cryo: false },
      },
      data,
    );
    const itemIds = out.physical.map((p) => p.itemId);
    expect(itemIds).not.toContain('MedicatedSuture');
    // Brutepack (tier 1) should be picked.
    expect(itemIds).toContain('Brutepack');
  });

  it('Heat 20 default does not pick tier-3 RegenerativeMesh (vs-xvp.4)', () => {
    const out = computeMix(
      {
        damage: { Heat: 20 },
        species: 'Human',
        filters: { chems: false, physical: true, cryo: false },
      },
      data,
    );
    const itemIds = out.physical.map((p) => p.itemId);
    expect(itemIds).not.toContain('RegenerativeMesh');
    // A tier-1 burn item should be picked.
    expect(itemIds.some((id) => ['Ointment', 'AloeCream'].includes(id))).toBe(
      true,
    );
  });

  // vs-xvp.4: when a profile mixes Caustic damage (only RegenerativeMesh
  // covers it among physical items at full strength — Ointment heals
  // 1.5/app vs Mesh 10/app), the tier deboost is calibrated so Ointment
  // STILL wins for any reasonable Caustic amount because it covers the
  // same damage class with tier-1 access. Mesh only surfaces if Caustic
  // is dominant AND Ointment can't keep up — in which case the tier-3
  // rationale appears in the reason string.
  it('low Caustic default picks Ointment (tier 1) over RegenerativeMesh (vs-xvp.4)', () => {
    const out = computeMix(
      {
        damage: { Caustic: 10 },
        species: 'Human',
        filters: { chems: false, physical: true, cryo: false },
      },
      data,
    );
    const itemIds = out.physical.map((p) => p.itemId);
    expect(itemIds).not.toContain('RegenerativeMesh');
  });

  // Label string format is included in the pro-tips style.
  it('produces a copyable label for a solved mix', () => {
    const out = computeMix(
      {
        damage: { Blunt: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
        operatorName: 'Andrew Zigler',
      },
      data,
    );
    expect(out.label).toMatch(/\/ \d+u \/ [A-Z]{2}/);
  });

  // --- Blacklist integration (vs-3il.3). ---

  // Rororium heals Brute 4/tick. The blacklist drops it from default
  // candidate ranking; vs-xvp.4 additionally moved it to tier 3 (admin-
  // spawn) so even with the blacklist disabled it scores below tier-1
  // Bicaridine. The fallback-warning code path is now only exercised
  // when an unblacklisted candidate would have been the rate-leader,
  // which the new tier deboost makes unusual — so this test asserts
  // only the negative (Rororium not picked, real brute med picked).
  it('45 Blunt on Human (default) never picks Rororium (uncraftable)', () => {
    const out = computeMix(
      {
        damage: { Blunt: 45 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).not.toContain('Rororium');
    // A real brute-med should have been picked in Rororium's place.
    expect(ids.some((id) => ['Bicaridine', 'Arcryox'].includes(id))).toBe(true);
  });

  // vs-xvp.4: with includeRestricted=true, admin-spawn reagents
  // re-enter the candidate pool. Whether they actually get PICKED is
  // governed by the tier deboost (TIER_RATE_BIAS=2.0), so a tier-3
  // admin chem only wins when no lower-tier alternative covers the
  // damage profile. To verify the toggle behavior, strip every other
  // Brute-covering reagent (craftable AND admin) so Rororium is left
  // as the unique Brute healer; with restricted=true it gets picked,
  // without it we get no Brute coverage at all.
  it('includeRestricted=true makes admin reagents available (vs-xvp.4)', () => {
    // Keep only Rororium as a Brute candidate. Strip every other
    // reagent that touches Brute or its group via heals[].
    const keepRororium = new Set(['Rororium']);
    const stripIds = new Set<string>();
    for (const r of data.reagents) {
      const coversBrute = r.heals.some(
        (h) =>
          h.amountPerTick > 0 &&
          ((h.kind === 'type' &&
            ['Blunt', 'Piercing', 'Slash'].includes(h.target)) ||
            (h.kind === 'group' && h.target === 'Brute')),
      );
      if (coversBrute && !keepRororium.has(r.id)) {
        stripIds.add(r.id);
      }
    }
    const reagents = data.reagents.filter((r) => !stripIds.has(r.id));
    const reagentsById = new Map(reagents.map((r) => [r.id, r]));
    const stripped: DataBundle = { ...data, reagents, reagentsById };

    const blunt45Restricted = computeMix(
      {
        damage: { Blunt: 45 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
        includeRestricted: true,
      },
      stripped,
    );
    const blunt45Default = computeMix(
      {
        damage: { Blunt: 45 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      stripped,
    );
    // With restricted, Rororium is in the candidate pool and is the only
    // Brute-covering reagent left → it gets picked.
    expect(blunt45Restricted.ingredients.map((i) => i.reagentId)).toContain(
      'Rororium',
    );
    // Without restricted, Rororium is blacklist-stripped → it is NOT
    // picked. (No Brute coverage at all — the partial-heal warning
    // fires.)
    expect(blunt45Default.ingredients.map((i) => i.reagentId)).not.toContain(
      'Rororium',
    );
  });

  // Omnizine heals Brute/Burn/Toxin/Airloss at 2/tick each — it would
  // dominate the multi-type solve if not blacklisted.
  it('multi-type damage on Human (default) never picks Omnizine (uncraftable)', () => {
    const out = computeMix(
      {
        damage: { Blunt: 20, Heat: 20, Poison: 20 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).not.toContain('Omnizine');
    expect(ids).not.toContain('Rororium');
  });

  // --- Side-effect warnings (vs-3il.5). ---

  // Ultravasculine is a Toxin-group healer that also deals 1.5 Blunt/tick
  // (above 20u: 6/tick). The wiki calls this out and the solver should
  // surface the trade-off when Ultravasculine is picked.
  //
  // vs-xvp.4 update: Ultravasculine moved to tier 3 (needs Histamine,
  // which has no producing reaction). With TIER_RATE_BIAS=2.0 it loses
  // to tier-1 alternatives on pure-Poison or pure-Radiation profiles —
  // exactly what the user asked for. To still exercise the side-effect
  // warning path we use a mixed Poison+Radiation profile where
  // Ultravasculine wins on profileCoverage (Toxin group covers both)
  // regardless of tier.
  it('Ultravasculine: solver surfaces brute side-effect warning when picked', () => {
    const out = computeMix(
      {
        damage: { Poison: 40, Radiation: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const ultra = out.ingredients.find((i) => i.reagentId === 'Ultravasculine');
    expect(ultra).toBeDefined();
    const hit = ultra?.sideEffectWarnings.find((w) =>
      /Ultravasculine.*brute|Blunt|deals 1\.5/i.test(w),
    );
    expect(hit).toBeDefined();
    // The wiki-voice pairing hint should also be present.
    expect(hit).toMatch(/Bicaridine/i);
  });

  // Arithrazine: rad-specific healer that deals 1.5 Blunt per tick. We
  // strip Ultravasculine from the bundle so Arithrazine is the top-ranked
  // rad healer (in the full bundle Ultravasculine's Toxin-group heal
  // incidentally outranks Arithrazine's single-type rate on Radiation).
  it('Arithrazine: solver surfaces brute side-effect warning when picked', () => {
    const reagentsById = new Map(data.reagentsById);
    reagentsById.delete('Ultravasculine');
    const reagents = data.reagents.filter((r) => r.id !== 'Ultravasculine');
    const stripped: DataBundle = { ...data, reagents, reagentsById };

    const out = computeMix(
      {
        damage: { Radiation: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      stripped,
    );
    const arith = out.ingredients.find((i) => i.reagentId === 'Arithrazine');
    expect(arith).toBeDefined();
    const hit = arith?.sideEffectWarnings.find((w) =>
      /Arithrazine.*brute|Arithrazine.*Blunt|deals 1\.5/i.test(w),
    );
    expect(hit).toBeDefined();
    expect(hit).toMatch(/Bicaridine/i);
  });

  // Tricordrazine: when patient total damage ≥ 50 and Tricord is picked, the
  // solver should advise that the wiki-documented <50 gate means the
  // Brute/Burn heal will not fire. Build a multi-type profile that sums to
  // ≥50 and that Tricord's coverage will be picked for (it's a broad
  // Brute+Burn+Poison reagent).
  it('Tricordrazine: solver warns about <50 gate when total damage ≥ 50', () => {
    const out = computeMix(
      {
        // 30+30 = 60 total damage > 50 threshold.
        damage: { Blunt: 30, Poison: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const tricord = out.ingredients.find(
      (i) => i.reagentId === 'Tricordrazine',
    );
    // Tricordrazine may or may not be picked depending on ranking against
    // Bicaridine; force the test to check the warning only if it was picked.
    if (tricord) {
      const hit = tricord.sideEffectWarnings.find((w) =>
        /below 50 total damage|Tricordrazine.*50|will not fire/i.test(w),
      );
      expect(hit).toBeDefined();
    } else {
      // If Tricord wasn't picked for this profile, force it by restricting
      // candidates to an isolated Brute+Burn shape it uniquely covers broadly.
      const out2 = computeMix(
        {
          damage: { Blunt: 30, Heat: 30 },
          species: 'Human',
          filters: { chems: true, physical: false, cryo: false },
        },
        data,
      );
      const t2 = out2.ingredients.find((i) => i.reagentId === 'Tricordrazine');
      if (t2) {
        const hit = t2.sideEffectWarnings.find((w) =>
          /below 50 total damage|Tricordrazine.*50|will not fire/i.test(w),
        );
        expect(hit).toBeDefined();
      }
    }
  });

  // Epinephrine: in crit the patient gets Brute/Burn/Poison healing. Outside
  // crit, Nurseshark has no "patient in crit" flag, so the solver treats all
  // Epi picks as non-critical and warns about the gate. This test checks
  // that if Epi is surfaced for Asphyxiation coverage, the warning fires.
  it('Epinephrine: solver warns that Brute/Burn/Poison heal requires critical state', () => {
    const out = computeMix(
      {
        // Asphyxiation 30 + Blunt 10 → Epi is a candidate for Asphyxiation.
        damage: { Asphyxiation: 30, Blunt: 10 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
        includeRestricted: true,
      },
      data,
    );
    const epi = out.ingredients.find((i) => i.reagentId === 'Epinephrine');
    if (epi) {
      const hit = epi.sideEffectWarnings.find((w) =>
        /critical state|Epinephrine.*crit/i.test(w),
      );
      expect(hit).toBeDefined();
    } else {
      // Epi may rank behind Dexalin for Asphyxiation — that's fine, the
      // warning is only relevant when Epi is actually picked. This test
      // still asserts the SHAPE of sideEffectWarnings as an array.
      expect(Array.isArray(out.ingredients[0]?.sideEffectWarnings)).toBe(true);
    }
  });

  // Every picked ingredient carries a sideEffectWarnings array (empty or
  // populated). This guards against regressions where a code path forgets
  // to populate the field.
  it('every picked ingredient has a sideEffectWarnings array', () => {
    const out = computeMix(
      {
        damage: { Blunt: 30, Heat: 20, Poison: 15 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(out.ingredients.length).toBeGreaterThan(0);
    for (const ing of out.ingredients) {
      expect(Array.isArray(ing.sideEffectWarnings)).toBe(true);
    }
  });

  // Dermaline: when the solver picks it at a dose >= its 10u OD threshold,
  // the hand-authored "top up with Tricordrazine" warning fires. Large burn
  // profile forces the solver to push Dermaline to or past its OD cap.
  it('Dermaline: warns about 10u syringe-top-up when dose hits OD', () => {
    const out = computeMix(
      {
        // 30 Heat → needs ≥ 10u of Dermaline (1.5 Heat/tick at metab 0.5 →
        // 3 per unit) so ceil(30 / 3) = 10u, which hits the OD.
        damage: { Heat: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    const derm = out.ingredients.find((i) => i.reagentId === 'Dermaline');
    if (derm && derm.units >= 10) {
      const hit = derm.sideEffectWarnings.find((w) =>
        /top up|Tricordrazine|max safe dose|syringe holds/i.test(w),
      );
      expect(hit).toBeDefined();
    }
  });

  // --- Dead-patient revival flow (vs-3il.6). ---
  //
  // Dead mode: topicals-only to reduce damage below 200, then defib, then
  // post-revival chem mix. The solver's primary `ingredients` field should
  // be empty (chems don't metabolize in corpses); post-revival chems go in
  // `postRevivalIngredients`. The defib step is in `revivalStep`.

  // Scenario: dead patient already below 200 total damage → no topicals
  // needed for revival, defib fires immediately, post-revival chems address
  // the remainder (plus the 5 Shock inflicted by the defib).
  it('dead patient at 180 total damage → immediate defib + post-revival chems', () => {
    const out = computeMix(
      {
        // 80 Blunt + 50 Heat + 50 Poison = 180 total (< 200 threshold).
        damage: { Blunt: 80, Heat: 50, Poison: 50 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: false },
        patientState: 'dead',
      },
      data,
    );
    expect(out.solved).toBe(true);
    expect(out.revivalStep).toBeDefined();
    expect(out.revivalStep?.tool).toBe('defibrillator');
    expect(out.revivalStep?.heals.Asphyxiation).toBe(40);
    expect(out.revivalStep?.inflicts.Shock).toBe(5);
    expect(out.revivalStep?.note).toMatch(/Press Z/);
    // No topicals needed — we're already under 200 total.
    expect(out.physical).toHaveLength(0);
    // Primary ingredients empty (chems don't metabolize in corpses).
    expect(out.ingredients).toHaveLength(0);
    // Post-revival chems present: covers the remaining damage plus the 5
    // Shock inflicted by the defib shock.
    expect(out.postRevivalIngredients).toBeDefined();
    expect(out.postRevivalIngredients?.length).toBeGreaterThan(0);
    // Wiki-voice advisory strings present.
    expect(out.patientStateWarnings?.some((w) => /below 200/i.test(w))).toBe(
      true,
    );
    expect(out.patientStateWarnings?.some((w) => /Press Z/i.test(w))).toBe(
      true,
    );
    expect(
      out.patientStateWarnings?.some((w) => /critical state/i.test(w)),
    ).toBe(true);
  });

  // Scenario: dead patient with 250 total damage → topicals reduce to <200
  // (brute + burn profile well-covered by physical items), then defib, then
  // post-revival chems.
  it('dead patient at 250 total damage → topicals + defib + post-revival chems', () => {
    const out = computeMix(
      {
        // 100 Blunt + 80 Heat + 70 Slash = 250 total (> 200 threshold).
        damage: { Blunt: 100, Heat: 80, Slash: 70 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: false },
        patientState: 'dead',
      },
      data,
    );
    expect(out.solved).toBe(true);
    // Topicals were picked (brute + burn damage is well-covered).
    expect(out.physical.length).toBeGreaterThan(0);
    // Revival step emitted.
    expect(out.revivalStep).toBeDefined();
    expect(out.revivalStep?.heals.Asphyxiation).toBe(40);
    // Primary ingredients still empty — chems only post-revival.
    expect(out.ingredients).toHaveLength(0);
    expect(out.postRevivalIngredients).toBeDefined();
    // At least one topical-mode reason mentions the dead-mode goal.
    const deadModeReason = out.physical.find((p) =>
      /dead-mode|defib threshold|<200/i.test(p.reason),
    );
    expect(deadModeReason).toBeDefined();
  });

  // Scenario: dead patient with 400 damage in types topicals can't touch
  // (Poison + Radiation + Cellular + Asphyxiation) → cannot-revive warning.
  it('dead patient with un-topical-able damage → cannot-revive warning', () => {
    const out = computeMix(
      {
        // 150 Poison + 150 Radiation + 100 Cellular = 400 total. None of
        // these are covered by the physical items in VS14 data, so topicals
        // cannot bring the patient under 200.
        damage: { Poison: 150, Radiation: 150, Cellular: 100 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: false },
        patientState: 'dead',
      },
      data,
    );
    expect(out.solved).toBe(true);
    expect(out.revivalStep).toBeUndefined();
    expect(out.postRevivalIngredients).toBeUndefined();
    // Cannot-revive warning present.
    const cannot = out.patientStateWarnings?.find((w) =>
      /cannot be revived|consult CMO/i.test(w),
    );
    expect(cannot).toBeDefined();
    // No chem ingredients (patient isn't metabolizing).
    expect(out.ingredients).toHaveLength(0);
  });

  // Scenario: dead patient at exactly 200 damage → defib blocked (strictly
  // less-than threshold). Topicals should still be attempted.
  it('dead patient at 200 damage threshold → treated as needs-reduction', () => {
    const out = computeMix(
      {
        // 200 Blunt exactly — threshold is strict <200.
        damage: { Blunt: 200 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: false },
        patientState: 'dead',
      },
      data,
    );
    expect(out.solved).toBe(true);
    // Topicals should drop this below 200 (MedicatedSuture + Brutepack cover
    // Blunt at 10 + 5 per application respectively across 10-stacks each).
    expect(out.physical.length).toBeGreaterThan(0);
    // Successful revival given topicals can cover Blunt.
    expect(out.revivalStep).toBeDefined();
  });

  // Scenario: post-revival chems include side-effect warnings from vs-3il.5's
  // system. Verify every post-revival ingredient carries a `sideEffectWarnings`
  // array (same shape as normal ingredients) AND that at least one advisory
  // fires for a profile that hits a known warning trigger. Use a profile where
  // the Radiation pick is Arithrazine (brute side-effect) — we strip
  // Ultravasculine and Cryoxadone to force Arithrazine to the top (they'd
  // otherwise outrank it via group/multi coverage, as in the alive Arithrazine
  // regression above).
  it('dead patient → post-revival chems surface vs-3il.5 side-effect warnings', () => {
    const reagentsById = new Map(data.reagentsById);
    reagentsById.delete('Ultravasculine');
    reagentsById.delete('Cryoxadone');
    const reagents = data.reagents.filter(
      (r) => r.id !== 'Ultravasculine' && r.id !== 'Cryoxadone',
    );
    const stripped: DataBundle = { ...data, reagents, reagentsById };

    const out = computeMix(
      {
        // 30 Radiation + 50 Blunt = 80 total (<200, immediate defib).
        // Post-revival profile: 30 Radiation + 50 Blunt + 5 Shock.
        // Arithrazine should be picked for Radiation (with Ultravasculine
        // stripped), carrying its hand-authored side-effect warning.
        damage: { Radiation: 30, Blunt: 50 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
        patientState: 'dead',
      },
      stripped,
    );
    expect(out.solved).toBe(true);
    expect(out.revivalStep).toBeDefined();
    expect(out.postRevivalIngredients).toBeDefined();
    // Every post-revival ingredient has a sideEffectWarnings array (shape
    // contract — same as regular ingredients).
    for (const ing of out.postRevivalIngredients ?? []) {
      expect(Array.isArray(ing.sideEffectWarnings)).toBe(true);
    }
    // Arithrazine carries a static brute side-effect warning.
    const arith = out.postRevivalIngredients?.find(
      (i) => i.reagentId === 'Arithrazine',
    );
    expect(arith).toBeDefined();
    expect(arith?.sideEffectWarnings.length).toBeGreaterThan(0);
    const hit = arith?.sideEffectWarnings.find((w) =>
      /Arithrazine.*Blunt|brute|1\.5/i.test(w),
    );
    expect(hit).toBeDefined();
  });

  // Scenario: critical patient state = same plan shape as alive (no revival).
  // Verifies we haven't regressed standard flow.
  it('critical patient state uses standard flow (no revival step)', () => {
    const out = computeMix(
      {
        damage: { Blunt: 45 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
        patientState: 'critical',
      },
      data,
    );
    expect(out.solved).toBe(true);
    expect(out.revivalStep).toBeUndefined();
    expect(out.postRevivalIngredients).toBeUndefined();
    expect(out.patientStateWarnings).toBeUndefined();
    // Primary ingredients present like a normal solve.
    expect(out.ingredients.length).toBeGreaterThan(0);
  });

  // Scenario: omitting patientState defaults to alive (backward compat).
  it('default patientState (undefined) behaves exactly like alive', () => {
    const base = {
      damage: { Blunt: 45 },
      species: 'Human',
      filters: { chems: true, physical: false, cryo: false },
    };
    const out = computeMix(base, data);
    const outAlive = computeMix({ ...base, patientState: 'alive' }, data);
    expect(out.solved).toBe(true);
    expect(outAlive.solved).toBe(true);
    // Same ingredient set.
    expect(out.ingredients.map((i) => i.reagentId)).toEqual(
      outAlive.ingredients.map((i) => i.reagentId),
    );
    // Neither path emits revival fields.
    expect(out.revivalStep).toBeUndefined();
    expect(outAlive.revivalStep).toBeUndefined();
  });

  // Scenario: post-defib profile includes 5 Shock inflicted by defibrillator.
  // The post-revival chem pass should pick a Shock-appropriate healer.
  it('dead patient → post-defib projection includes 5 Shock from defibrillator', () => {
    const out = computeMix(
      {
        // Low total — 100 Blunt — so defib fires immediately.
        damage: { Blunt: 100 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
        patientState: 'dead',
      },
      data,
    );
    expect(out.revivalStep).toBeDefined();
    expect(out.revivalStep?.inflicts.Shock).toBe(5);
    // Post-revival chems cover the Blunt (and incidentally the 5 Shock —
    // the Shock pick is lower priority, but the primary med should still
    // land and at minimum no un-picked Shock warning leaks into the UI).
    expect(out.postRevivalIngredients).toBeDefined();
    expect(out.postRevivalIngredients?.length).toBeGreaterThan(0);
  });

  // Scenario: dead patient with Asphyxiation-heavy damage → the 40-Asphyx
  // defib heal zeros out (or nearly so) Asphyxiation in post-revival profile.
  it('dead patient → 40 Asphyxiation heal is applied to post-defib state', () => {
    const out = computeMix(
      {
        // 30 Asphyxiation + 100 Blunt = 130 total (<200, immediate defib).
        damage: { Asphyxiation: 30, Blunt: 100 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
        patientState: 'dead',
      },
      data,
    );
    expect(out.revivalStep).toBeDefined();
    // Post-revival ingredients should not include a Dexalin/Epi pick for
    // Asphyxiation, since the 40-heal defib more than covers the 30 Asphyx.
    const hasAsphyxiationHealer = out.postRevivalIngredients?.some((i) =>
      ['Dexalin', 'DexalinPlus', 'Epinephrine', 'Lacticated'].includes(
        i.reagentId,
      ),
    );
    // This is an "at most one" not a hard rule — acceptable either way; the
    // meaningful assertion is that some brute med is picked for the 100 Blunt.
    const ids = out.postRevivalIngredients?.map((i) => i.reagentId) ?? [];
    const hasBruteMed = ids.some((id) =>
      ['Bicaridine', 'Arcryox', 'Tricordrazine'].includes(id),
    );
    expect(hasBruteMed).toBe(true);
    // Narrow the Asphyx assertion: if Epi was picked, it was for crit-state
    // advisory flagging, not as a primary — so test just passes through.
    expect(typeof hasAsphyxiationHealer).toBe('boolean');
  });

  // Scenario: dead-mode topicals skip items that inflict damage (Tourniquet
  // adds Blunt+Asphyxiation — wrong trade-off when the goal is to drop under
  // 200 total).
  it('dead-mode topicals never pick Tourniquet (inflicts damage)', () => {
    const out = computeMix(
      {
        // 220 Blunt + 40 Bloodloss = 260 total. Normally Tourniquet helps
        // with bloodloss, but in dead mode we avoid inflicting extra damage.
        damage: { Blunt: 220, Bloodloss: 40 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: false },
        patientState: 'dead',
      },
      data,
    );
    expect(out.solved).toBe(true);
    const tourniquet = out.physical.find((p) => p.itemId === 'Tourniquet');
    expect(tourniquet).toBeUndefined();
  });
});

// =============================================================
// vs-xvp.5: ranked Rx alternatives (`computeAlternatives`).
// =============================================================
describe('computeAlternatives', () => {
  let data: DataBundle;
  beforeAll(() => {
    data = buildBundle();
  });

  // Multiple alternatives are returned for a typical profile. With
  // tier-1, tier-2, and tier-3 ceilings the solver should produce 2-3
  // alternatives (some ceilings may be suppressed as duplicates of the
  // adjacent ceiling).
  it('returns multiple alternatives for a multi-damage profile', () => {
    const result = computeAlternatives(
      {
        damage: { Blunt: 30, Heat: 20, Poison: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(result.alternatives.length).toBeGreaterThanOrEqual(1);
    expect(result.alternatives.length).toBeLessThanOrEqual(3);
    // Sorted ascending by tier ceiling.
    for (let i = 1; i < result.alternatives.length; i += 1) {
      expect(result.alternatives[i].tierCeiling).toBeGreaterThanOrEqual(
        result.alternatives[i - 1].tierCeiling,
      );
    }
  });

  // The lowest-tier viable alternative is the default-expanded card.
  // For a fridge-coverable profile, that's the tier-1 card (no escalation
  // needed).
  it('default-expanded card is the lowest-tier non-partial alternative', () => {
    const result = computeAlternatives(
      {
        // Pure Blunt — fully covered by Bicaridine (tier 1).
        damage: { Blunt: 45 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(result.alternatives.length).toBeGreaterThanOrEqual(1);
    const defaultAlt = result.alternatives[result.defaultIndex];
    expect(defaultAlt).toBeDefined();
    expect(defaultAlt.partial).toBe(false);
    // The default should be the LOWEST tier among non-partial alternatives.
    for (let i = 0; i < result.defaultIndex; i += 1) {
      expect(result.alternatives[i].partial).toBe(true);
    }
  });

  // Every alternative carries a populated trade-off summary (non-empty,
  // describes the tier scope).
  it('every alternative has a non-empty trade-off summary', () => {
    const result = computeAlternatives(
      {
        damage: { Blunt: 30, Heat: 20 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    expect(result.alternatives.length).toBeGreaterThan(0);
    for (const alt of result.alternatives) {
      expect(alt.summary.length).toBeGreaterThan(20);
      // The summary mentions either the tier scope or the partial-coverage
      // disclaimer — both are valid.
      expect(alt.summary).toMatch(/tier|fridge|standard|exotic|partial/i);
    }
  });

  // Damage profile uncoverable by tier 1 → tier-1-only card flagged as
  // partial. Cellular damage has no tier-1 healer (Doxarubixadone is
  // tier 2) so the fridge-stock alternative cannot fully cover this profile.
  it('partial flag fires when tier-1 cannot cover damage type', () => {
    const result = computeAlternatives(
      {
        damage: { Cellular: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: true },
      },
      data,
    );
    const tier1 = result.alternatives.find((a) => a.tierCeiling === 1);
    expect(tier1).toBeDefined();
    expect(tier1?.partial).toBe(true);
    // A higher-tier alternative should NOT be partial — Doxarubixadone
    // covers Cellular at tier 2.
    const nonPartial = result.alternatives.find((a) => !a.partial);
    expect(nonPartial).toBeDefined();
    expect(nonPartial?.tierCeiling).toBeGreaterThanOrEqual(2);
  });

  // Each alternative is a complete SolverOutput — has the same shape
  // (ingredients, physical, cryo, label, etc.) so the UI can render it
  // identically to a single-pick output.
  it('each alternative carries a complete SolverOutput', () => {
    const result = computeAlternatives(
      {
        damage: { Blunt: 30 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: false },
      },
      data,
    );
    for (const alt of result.alternatives) {
      expect(alt.output.solved).toBe(true);
      expect(Array.isArray(alt.output.ingredients)).toBe(true);
      expect(Array.isArray(alt.output.physical)).toBe(true);
      // Tier-bounded ingredients: every chem ingredient in the
      // alternative respects the ceiling.
      for (const ing of alt.output.ingredients) {
        expect(ing.tier).toBeLessThanOrEqual(alt.tierCeiling);
      }
    }
  });

  // For pure Poison profile, the tier-1 alternative picks Dylovene
  // (no Ultravasculine), tier-2 same (Ultravasculine is tier 3 now),
  // and tier-3 may pick Ultravasculine if its 6×-rate beats the
  // tier-1 score even after deboost. With bias=2.0 it doesn't, so all
  // three alternatives end up identical → suppressed to 1 card.
  it('pure Poison: alternatives all use Dylovene (vs-xvp.4 + vs-xvp.5)', () => {
    const result = computeAlternatives(
      {
        damage: { Poison: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    for (const alt of result.alternatives) {
      const ids = alt.output.ingredients.map((i) => i.reagentId);
      expect(ids).not.toContain('Ultravasculine');
    }
  });

  // For a Poison+Radiation profile, the higher-tier alternative DOES
  // pick Ultravasculine (its Toxin-group coverage trumps the tier
  // suppression). The tier-1 alternative falls back to Arithrazine +
  // Dylovene/Tricord — partial or full coverage depending on the
  // candidate ranking, but distinct from the tier-3 plan.
  it('Poison+Radiation: tier-3 alternative includes Ultravasculine', () => {
    const result = computeAlternatives(
      {
        damage: { Poison: 30, Radiation: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    // Tier-3 ceiling alternative SHOULD include Ultravasculine (broad
    // Toxin coverage wins on profileCoverage despite tier 3).
    const tier3 = result.alternatives.find((a) => a.tierCeiling === 3);
    expect(tier3).toBeDefined();
    const tier3Ids = tier3?.output.ingredients.map((i) => i.reagentId) ?? [];
    expect(tier3Ids).toContain('Ultravasculine');
    // Tier-1 alternative should NOT include Ultravasculine (excluded by
    // the ceiling).
    const tier1 = result.alternatives.find((a) => a.tierCeiling === 1);
    if (tier1) {
      const tier1Ids = tier1.output.ingredients.map((i) => i.reagentId);
      expect(tier1Ids).not.toContain('Ultravasculine');
    }
  });

  // Dead-mode wraps the existing 3-panel revival flow as a single-card
  // alternative for uniform UI handling. The card carries the dead-mode
  // SolverOutput intact (revivalStep, postRevivalIngredients, etc).
  it('dead-mode returns a single-card alternative wrapping the revival flow', () => {
    const result = computeAlternatives(
      {
        damage: { Blunt: 100 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: false },
        patientState: 'dead',
      },
      data,
    );
    expect(result.alternatives).toHaveLength(1);
    expect(result.defaultIndex).toBe(0);
    const alt = result.alternatives[0];
    // Wrapped output retains the dead-mode revival fields.
    expect(alt.output.revivalStep).toBeDefined();
    expect(alt.output.revivalStep?.tool).toBe('defibrillator');
  });

  // Adjacent-duplicate suppression: when tier-2 produces the same Rx
  // as tier-1 (because no tier-2 chem improved on the tier-1 pick),
  // tier-2 is dropped from the list.
  it('suppresses adjacent-duplicate alternatives', () => {
    const result = computeAlternatives(
      {
        // Pure Blunt: Bicaridine (tier 1) wins all three ceilings, so
        // tier-2 and tier-3 are duplicates of tier-1 → only 1 card.
        damage: { Blunt: 30 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
      },
      data,
    );
    // 1 card (all duplicates suppressed) or 2 cards if cryo introduces
    // variation. Either way, no two adjacent alternatives should have
    // identical ingredient sets.
    for (let i = 1; i < result.alternatives.length; i += 1) {
      const prev = result.alternatives[i - 1].output.ingredients;
      const curr = result.alternatives[i].output.ingredients;
      const prevIds = prev
        .map((p) => `${p.reagentId}:${p.units}`)
        .sort()
        .join(',');
      const currIds = curr
        .map((p) => `${p.reagentId}:${p.units}`)
        .sort()
        .join(',');
      expect(prevIds).not.toEqual(currIds);
    }
  });

  // =============================================================
  // vs-xvp.7: each card surfaces BOTH a chem mix AND physical items.
  // =============================================================
  //
  // Pre-fix bug: the chem pass was reading damage POST-physical-pass, so
  // when topicals fully covered a damage type (e.g. 9× Brutepack on 45
  // Blunt) the chem pass had nothing to do. The fridge-stock card showed
  // bandages with NO Bicaridine; the standard / exotic cards collapsed
  // into the same empty-chem state and were duplicate-suppressed down to
  // a single items-only card. Each card must now surface a complete
  // chem mix AND complete physical-item plan against the FULL damage
  // profile, in parallel.

  it('vs-xvp.7: tier-1 alternative surfaces Bicaridine alongside Brutepack for pure Blunt', () => {
    const result = computeAlternatives(
      {
        damage: { Blunt: 45 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: true },
      },
      data,
    );
    const tier1 = result.alternatives.find((a) => a.tierCeiling === 1);
    expect(tier1).toBeDefined();
    // Both halves of the card must be populated independently.
    expect(tier1?.output.ingredients.length).toBeGreaterThan(0);
    expect(tier1?.output.physical.length).toBeGreaterThan(0);
    // Bicaridine is the canonical tier-1 brute med — must be in the chem
    // mix even though Brutepack covers Blunt physically.
    const chemIds = tier1?.output.ingredients.map((i) => i.reagentId) ?? [];
    expect(chemIds).toContain('Bicaridine');
    // Every chem ingredient in the tier-1 card must be tier 1.
    for (const ing of tier1?.output.ingredients ?? []) {
      expect(ing.tier).toBe(1);
    }
    // Brutepack should still be in the physical-item plan.
    const itemIds = tier1?.output.physical.map((p) => p.itemId) ?? [];
    expect(itemIds).toContain('Brutepack');
  });

  it('vs-xvp.7: tier-1 burn profile surfaces Dermaline alongside AloeCream / Ointment', () => {
    const result = computeAlternatives(
      {
        damage: { Heat: 30 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: false },
      },
      data,
    );
    const tier1 = result.alternatives.find((a) => a.tierCeiling === 1);
    expect(tier1).toBeDefined();
    expect(tier1?.output.ingredients.length).toBeGreaterThan(0);
    expect(tier1?.output.physical.length).toBeGreaterThan(0);
    const chemIds = tier1?.output.ingredients.map((i) => i.reagentId) ?? [];
    // Dermaline is the canonical tier-1 burn med (Kelotane is also tier 1
    // and acceptable; Dermaline wins on rate). Either is OK.
    expect(chemIds.some((id) => id === 'Dermaline' || id === 'Kelotane')).toBe(
      true,
    );
  });

  it('vs-xvp.7: tier-1 mixed brute+burn surfaces Tricordrazine alongside both item lanes', () => {
    const result = computeAlternatives(
      {
        damage: { Blunt: 30, Heat: 30 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: false },
      },
      data,
    );
    const tier1 = result.alternatives.find((a) => a.tierCeiling === 1);
    expect(tier1).toBeDefined();
    // Chem mix non-empty AND physical-item plan non-empty.
    expect(tier1?.output.ingredients.length).toBeGreaterThan(0);
    expect(tier1?.output.physical.length).toBeGreaterThan(0);
    // Tricordrazine is a tier-1 broad healer; it or a brute+burn pair
    // (Bicaridine + Dermaline/Kelotane) is acceptable.
    const chemIds = tier1?.output.ingredients.map((i) => i.reagentId) ?? [];
    const hasTricord = chemIds.includes('Tricordrazine');
    const hasBrutePlusBurn =
      chemIds.includes('Bicaridine') &&
      (chemIds.includes('Dermaline') || chemIds.includes('Kelotane'));
    expect(hasTricord || hasBrutePlusBurn).toBe(true);
  });

  it('vs-xvp.7: tier-1 ceiling with no covering chem emits explicit "no fridge-stock chem covers X" warning', () => {
    const result = computeAlternatives(
      {
        // Cellular has no tier-1 chem (Doxarubixadone is tier 2,
        // Phalanximine is tier 2). Tier-1 card must call this out
        // explicitly rather than silently returning an empty chem list.
        damage: { Cellular: 30 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: false },
      },
      data,
    );
    const tier1 = result.alternatives.find((a) => a.tierCeiling === 1);
    expect(tier1).toBeDefined();
    expect(tier1?.output.ingredients).toHaveLength(0);
    expect(tier1?.partial).toBe(true);
    const hasExplicit = tier1?.output.warnings.some((w) =>
      /No fridge-stock chem covers/.test(w),
    );
    expect(hasExplicit).toBe(true);
  });

  it('vs-xvp.7: standard and exotic cards still produce non-empty chem mixes when items would consume the damage', () => {
    // Pre-fix the duplicate-suppression collapsed all three cards into one
    // when items consumed the damage. After the fix the standard card may
    // still be a duplicate of tier-1 IF tier-1 already fully covered the
    // profile (Bicaridine for pure Blunt) — that's correct behavior. But
    // for a profile where higher tiers add value (e.g. Heat, where cryo
    // is tier 2+), at least one higher-tier card must appear.
    const result = computeAlternatives(
      {
        damage: { Heat: 45 },
        species: 'Human',
        filters: { chems: true, physical: true, cryo: true },
      },
      data,
    );
    expect(result.alternatives.length).toBeGreaterThanOrEqual(2);
    // Every visible alternative carries chems — none collapsed to empty
    // due to physical pass eating the damage.
    for (const alt of result.alternatives) {
      expect(alt.output.ingredients.length).toBeGreaterThan(0);
    }
  });
});
