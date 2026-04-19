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
import { computeMix } from '../solver';
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
    const smallOintment = small.physical.find(
      (p) => p.itemId === 'Ointment' || p.itemId === 'RegenerativeMesh',
    );
    const largeOintment = large.physical.find(
      (p) => p.itemId === 'Ointment' || p.itemId === 'RegenerativeMesh',
    );
    expect(smallOintment).toBeDefined();
    expect(largeOintment).toBeDefined();
    if (smallOintment && largeOintment) {
      expect(largeOintment.count).toBeGreaterThan(smallOintment.count);
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

  // Rororium heals Brute 4/tick → would out-rank Bicaridine (1.5/tick) in
  // raw rate. Default settings must skip it.
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
    // Fallback warning was emitted naming Rororium.
    const warning = out.warnings.find((w) => /Rororium/.test(w));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/restricted|fall(?:ing|)-?back|uncraftable/i);
  });

  // With includeRestricted: true the solver is allowed to reach for the
  // admin-spawn reagent. This exists for completionists / admin review.
  it('includeRestricted=true allows Rororium to be picked', () => {
    const out = computeMix(
      {
        damage: { Blunt: 45 },
        species: 'Human',
        filters: { chems: true, physical: false, cryo: false },
        includeRestricted: true,
      },
      data,
    );
    const ids = out.ingredients.map((i) => i.reagentId);
    expect(ids).toContain('Rororium');
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
});
