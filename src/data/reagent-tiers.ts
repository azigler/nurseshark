// Hand-curated availability tiers for medicinal reagents (vs-xvp.2,
// re-audited vs-xvp.4).
//
// The Nurseshark solver originally minimized total unit count, which
// surfaced exotic / hard-to-source chems over the basic medical-fridge
// stock the medic actually carries. The tier system encodes the practical
// "what's in arm's reach right now" knowledge so the solver biases its
// recommendation toward fridge stock when fridge stock can do the job.
//
// =====================================================================
//  vs-xvp.4 framework — apply to EVERY reagent, conservative bias when
//  in doubt (prefer the higher tier so the solver doesn't accidentally
//  route the medic toward an exotic chem when a basic one would do):
// =====================================================================
//
//   Tier 1 — medical-fridge pre-stock OR trivial chem-dispenser recipe.
//     The medic has these pre-made at round start (medibot loadouts,
//     fridge bottles, hypopens). Recipe is one of:
//       * 2 chem-dispenser elements (Bicaridine = Inaprovaline + Carbon),
//       * 3 chem-dispenser elements with no temperature gate,
//       * 1 tier-1 precursor + 1 element (Arithrazine = Hyronalin + H).
//     Examples: Bicaridine, Dermaline, Tricordrazine, Saline, Dylovene,
//     Inaprovaline, Kelotane, Hyronalin, Dexalin, Mannitol, Synaptizine,
//     Arithrazine.
//
//   Tier 2 — chem-dispenser recipe with 3+ inputs, OR requires a tier-1
//     precursor + 1 reaction step (often hot-plate temperature gate),
//     OR uses a chemmaster-only intermediate (Acetone, Phenol, Hydroxide,
//     UnstableMutagen) that's still entirely chem-lab reachable. Picks
//     here mean a synth run, but the medic finishes in one ChemMaster
//     session without leaving Medbay.
//     Examples: Bruizine, Lacerinol, Puncturase, Leporazine, Insuzine,
//     Pyrazine, Sigynate, Diphenhydramine, Cryoxadone, Doxarubixadone,
//     Phalanximine, Oculine, Haloperidol, TranexamicAcid, Epinephrine,
//     Psicodine, Charcoal.
//
//   Tier 3 — multi-step crafting, rare/admin/end-of-round-only, requires
//     sourcing from non-medical departments (botany, salvage, xenoarch),
//     or assembly from crafted components. Anything that requires a
//     reagent with NO producing reaction (Histamine, CarpoToxin, Aloe,
//     Stellibinin, ZombieBlood) is automatically tier 3 because the
//     medic must source the leaf reagent from a different game system.
//     Examples: Ultravasculine (needs Histamine — no producer; sourced
//     from poisoning side-effects), Aloxadone (needs botany Aloe),
//     Cognizine (needs CarpoToxin from carp + Siderlac chain),
//     Siderlac (needs botany Aloe + Stellibinin), Arcryox, Opporozidone
//     (deep-cryo chain), all admin/uncraftable tags.
//
// =====================================================================
//  vs-xvp.4 audit log (2026-04-25): Ultravasculine, Aloxadone, Cognizine,
//  Siderlac moved from tier 2 → tier 3. The previous pass was hand-
//  curated against the hoshizora-sayo guide section structure but didn't
//  consistently apply the "no producing reaction for a leaf input"
//  framework rule above; in-game testing surfaced Ultravasculine being
//  recommended for Poison profiles, which is exactly the bug. The
//  tier-3 deboost (TIER_RATE_BIAS) was simultaneously bumped from 0.4
//  to 2.0 so the suppression actually bites — see solver.ts.
// =====================================================================
//
// Sources cross-checked:
//   - https://hoshizora-sayo.github.io/bugmedical/chems.html
//     (Nurseshark's original inspiration — section headings literally are
//     "THE EASY STUFF (roundstart dispenser only)" → tier 1, "A BIT MORE
//     ADVANCED (chemmaster necessary)" → tier 2, "ADVANCED TREATMENT
//     (need botany + microwave)" → tier 3.)
//   - VS14 reaction graph (`src/gen/resolve-reactions.ts`): recipe depth,
//     temperature gates, presence of botany/salvage-only precursors.
//
// Reagents not in this table fall through to `DEFAULT_TIER` (tier 2). The
// effect on solver scoring is a small deboost — enough to favor a tier-1
// reagent that covers the same damage class, but not enough to override a
// strict damage-type match (e.g. Arithrazine remains the pick for
// Radiation; Doxarubixadone stays the Cellular pick when cryo is on; the
// user-facing "why" reason explains).

export type ReagentTier = 1 | 2 | 3;

export interface TierEntry {
  readonly id: string;
  readonly tier: ReagentTier;
  /** One-line wiki-voice rationale, surfaced when tier > 1 is necessary. */
  readonly rationale: string;
}

/** Default tier when a reagent isn't in `REAGENT_TIERS`. */
export const DEFAULT_TIER: ReagentTier = 2;

/**
 * Curated tier table. Cross-referenced against the hoshizora-sayo guide's
 * section structure (roundstart vs chemmaster vs botany) and VS14's actual
 * reaction definitions. Conservative bias: when in doubt, prefer the higher
 * tier (lower-priority pick) so the solver doesn't accidentally route the
 * medic toward an exotic chem when a basic one would do.
 *
 * Entries are grouped by tier with one-line justifications. Tier-3 entries
 * additionally call out the specific reason an exotic-only input is needed
 * ("requires Histamine — no producing reaction") so the next auditor can
 * spot-check without re-deriving from the reactions data.
 */
export const REAGENT_TIERS: readonly TierEntry[] = [
  // --- Tier 1: roundstart dispenser / medical fridge pre-stock ---
  {
    id: 'Inaprovaline',
    tier: 1,
    rationale: 'Stocks fridge — 3-element stabilizer, no chemmaster needed.',
  },
  {
    id: 'Bicaridine',
    tier: 1,
    rationale:
      'Brute fridge stock — Inaprovaline + carbon, premade in medibots.',
  },
  {
    id: 'Kelotane',
    tier: 1,
    rationale: 'Burn fridge stock — silicon + carbon, dispenser-only.',
  },
  {
    id: 'Dermaline',
    tier: 1,
    rationale: 'Burn fridge stock — Kelotane + oxygen + phosphorus.',
  },
  {
    id: 'Dylovene',
    tier: 1,
    rationale: 'Toxin fridge stock — silicon + nitrogen + potassium.',
  },
  {
    id: 'Saline',
    tier: 1,
    rationale: 'Bloodloss fridge stock — water + table salt, universal.',
  },
  {
    id: 'Dexalin',
    tier: 1,
    rationale: 'Airloss fridge stock — oxygen + plasma catalyst.',
  },
  {
    id: 'DexalinPlus',
    tier: 1,
    rationale: 'Airloss fridge stock — Dexalin + carbon + iron.',
  },
  {
    id: 'Hyronalin',
    tier: 1,
    rationale: 'Radiation precursor — radium + Dylovene, dispenser path.',
  },
  {
    id: 'Arithrazine',
    tier: 1,
    rationale: 'Radiation fridge stock — Hyronalin + hydrogen.',
  },
  {
    id: 'Tricordrazine',
    tier: 1,
    rationale: 'Broad <50-damage healer — Inaprovaline + Dylovene.',
  },
  {
    id: 'Cryptobiolin',
    tier: 1,
    rationale: 'Dispenser quick-mix — potassium + oxygen + sugar.',
  },
  {
    id: 'Mannitol',
    tier: 1,
    rationale: 'Brain-damage healer — hydrogen + water + sugar.',
  },
  {
    id: 'Synaptizine',
    tier: 1,
    rationale: 'Stun-recover stock — lithium + sugar + water.',
  },
  {
    id: 'PotassiumIodide',
    tier: 1,
    rationale: 'Radiation prophylaxis — potassium + iodine.',
  },
  {
    id: 'Heparin',
    tier: 1,
    rationale: 'Anti-clot stock — sulfuric + nitrogen + sodium.',
  },
  {
    id: 'Lipozine',
    tier: 1,
    rationale: 'Anti-fat — table salt + ethanol + radium.',
  },
  {
    id: 'Ipecac',
    tier: 1,
    rationale: 'Stomach-purge — potassium + nitrogen + ammonia.',
  },
  {
    id: 'Ethylredoxrazine',
    tier: 1,
    rationale: 'Anti-drunk — oxygen + Dylovene + carbon.',
  },

  // --- Tier 2: ChemMaster / temperature gates / multi-step (chem-lab reachable) ---
  {
    id: 'Bruizine',
    tier: 2,
    rationale: 'Specialized brute — chemmaster, Bicaridine + lithium + sugar.',
  },
  {
    id: 'Lacerinol',
    tier: 2,
    rationale: 'Specialized slash — temp 335K hot plate, Bic + benzene.',
  },
  {
    id: 'Puncturase',
    tier: 2,
    rationale: 'Specialized pierce — temp 325K, Bic + hydroxide.',
  },
  {
    id: 'Leporazine',
    tier: 2,
    rationale:
      'Cold/temp control — copper + fersilicite (1-step from elements), plasma catalyst.',
  },
  {
    id: 'Insuzine',
    tier: 2,
    rationale:
      'Shock specialist — temp 433K, Leporazine + Kelotane + silicon (1 chained step).',
  },
  {
    id: 'Pyrazine',
    tier: 2,
    rationale: 'Heat specialist — temp 540K, multi-precursor (slow heal).',
  },
  {
    id: 'Sigynate',
    tier: 2,
    rationale: 'Caustic specialist — temp 370K, 5-precursor recipe.',
  },
  {
    id: 'Diphenhydramine',
    tier: 2,
    rationale:
      'Histamine/poison reducer — temp 377K, Diethylamine + Oil + ethanol (chemmaster).',
  },
  {
    id: 'Cryoxadone',
    tier: 2,
    rationale:
      'Cryo-tube broad healer — Dexalin + water + oxygen (3-input, requires cryo tube to apply).',
  },
  {
    id: 'Doxarubixadone',
    tier: 2,
    rationale:
      'Cryo cellular — Cryoxadone + UnstableMutagen (chained chemmaster step).',
  },
  {
    id: 'Phalanximine',
    tier: 2,
    rationale:
      'Cellular damage — Hyronalin + ethanol + UnstableMutagen, all chem-lab reachable.',
  },
  {
    id: 'Oculine',
    tier: 2,
    rationale: 'Eye damage — table salt + blood + hydroxide.',
  },
  {
    id: 'Haloperidol',
    tier: 2,
    rationale: 'Anti-stim — 5-precursor recipe with PotassiumIodide.',
  },
  {
    id: 'TranexamicAcid',
    tier: 2,
    rationale: 'Bleed-stop — Inaprovaline + sulfuric + sugar.',
  },
  {
    id: 'Epinephrine',
    tier: 2,
    rationale:
      'Crit-stabilizer — Phenol + Acetone + chlorine + hydroxide (4-step chem-lab build).',
  },
  {
    id: 'Psicodine',
    tier: 2,
    rationale:
      'Anti-panic — Mannitol + Impedrezene + water (Impedrezene is chem-dispenser reachable).',
  },
  {
    id: 'Charcoal',
    tier: 2,
    rationale:
      'Antidote — heals 1 Poison/tick; ranks below Dylovene & friends.',
  },

  // --- Tier 3: exotic / botany / salvage / multi-system / admin-only ---
  // vs-xvp.4: each entry below MUST have an inline rationale calling out the
  // specific exotic-only input (no producing reaction in standard data, or
  // requires sourcing from a non-chem-lab game system).
  {
    id: 'Ultravasculine',
    tier: 3,
    // tier 3: requires Histamine — no producing reaction in standard data.
    // Histamine is generated as a poisoning side-effect of other reagents
    // (Mold, Theobromine, etc), so a chemist must intentionally poison the
    // patient or themselves to harvest it. Not fridge-reachable.
    rationale:
      'Exotic — needs Histamine, which has no producing reaction (sourced from poisoning side-effects, not chem-lab synthesis).',
  },
  {
    id: 'Aloxadone',
    tier: 3,
    // tier 3: requires Aloe, which is a botany-grown plant with no reaction.
    rationale:
      'Exotic — Cryoxadone + Leporazine + Aloe (Aloe has no producing reaction; must be grown by botany).',
  },
  {
    id: 'Cognizine',
    tier: 3,
    // tier 3: requires CarpoToxin (space carp salvage) + Siderlac (botany).
    rationale:
      'Exotic — needs CarpoToxin (space-carp salvage) + Siderlac (botany Aloe + Stellibinin chain). Multi-system.',
  },
  {
    id: 'Siderlac',
    tier: 3,
    // tier 3: requires Aloe AND Stellibinin, both botany leafs with no recipe.
    rationale:
      'Exotic — botany-only chain (Aloe + Stellibinin). Stellibinin is itself blacklist-flagged as botany-only.',
  },
  {
    id: 'Opporozidone',
    tier: 3,
    rationale:
      'Deep cryo — temp 400K, requires Cognizine + Doxarubixadone chain (Cognizine itself is tier 3).',
  },
  {
    id: 'Arcryox',
    tier: 3,
    rationale:
      'Exotic broad healer — temp 370K, Tricord + Cryoxadone + lithium (uses tier-2 cryo chem).',
  },
  {
    id: 'Ambuzol',
    tier: 3,
    rationale:
      'Anti-zombie — Dylovene + ammonia + ZombieBlood (no producing reaction; rare outbreak only).',
  },
  {
    id: 'AmbuzolPlus',
    tier: 3,
    rationale: 'Anti-zombie — needs Ambuzol + uncraftable Omnizine.',
  },
  {
    id: 'Diphenylmethylamine',
    tier: 3,
    rationale: 'Exotic — Ethyloxyephedrine + sodium carbonate + coffee.',
  },
  {
    id: 'Ethyloxyephedrine',
    tier: 3,
    rationale: 'Exotic — Desoxyephedrine (meth) + Stellibinin (botany leaf).',
  },
  {
    id: 'Barozine',
    tier: 3,
    rationale: 'No standard reaction — admin / world-seed only.',
  },
  {
    id: 'PolypyryliumOligomers',
    tier: 3,
    rationale: 'No reaction in standard data — admin / world-seed only.',
  },
  {
    id: 'Stellibinin',
    tier: 3,
    rationale: 'Botany only — galaxy thistle plant produce.',
  },
  {
    id: 'PulpedBananaPeel',
    tier: 3,
    rationale: 'Botany only — banana peel grind.',
  },
  {
    id: 'Holywater',
    tier: 3,
    rationale: 'Chaplain only — blessed water.',
  },
  {
    id: 'Omnizine',
    tier: 3,
    rationale: 'Uncraftable — admin/boss-drop only.',
  },
  {
    id: 'Rororium',
    tier: 3,
    rationale: 'Uncraftable — admin-spawn only.',
  },
  {
    id: 'Fresium',
    tier: 3,
    rationale:
      'Toxin-class metal — heals Heat 3/tick but inflicts Cold + freezes patient at high doses. Use Dermaline or cryo instead.',
  },
  {
    id: 'Stimulants',
    tier: 3,
    rationale:
      'Narcotic — heals only fire in critical state and the reagent inflicts 3 Poison/tick. Adversarial chem; not a medic-pick.',
  },
];

const TIER_BY_ID: ReadonlyMap<string, TierEntry> = new Map(
  REAGENT_TIERS.map((t) => [t.id, t]),
);

/**
 * Look up the tier of a reagent. Returns `DEFAULT_TIER` (2) for any reagent
 * not in the curated table — most unrecognised reagents are specialized
 * recipes by default, and the solver applies a small deboost.
 */
export function tierFor(reagentId: string): ReagentTier {
  return TIER_BY_ID.get(reagentId)?.tier ?? DEFAULT_TIER;
}

export function tierEntry(reagentId: string): TierEntry | null {
  return TIER_BY_ID.get(reagentId) ?? null;
}

// =====================================================================
//  Physical-item tiers (vs-xvp.4)
// =====================================================================
//
// Same framework as reagents, applied to medkit-style items:
//
//   Tier 1 — pre-stocked in any medkit / medibot loadout. Bandages,
//     gauze, ointment, brutepack, bloodpack, AloeCream — all standard
//     issue.
//   Tier 2 — found in advanced/specialized medkits but not always in
//     the round-start medbay drawer. (No items currently in this tier.)
//   Tier 3 — crafted from components (medicated suture = bandages +
//     Bicaridine; regenerative mesh = ointment + advanced burn
//     materials). Effectively unavailable until a chemist or surgeon
//     gathers components, OR end-of-round when an advanced medkit is
//     opened. The medic should NOT default to recommending these.
//
// Items not in the table default to `DEFAULT_PHYSICAL_ITEM_TIER` (1) —
// most stock items are roundstart-available; the exotics are the
// short hand-curated list below.

export type PhysicalItemTier = 1 | 2 | 3;

export const DEFAULT_PHYSICAL_ITEM_TIER: PhysicalItemTier = 1;

interface PhysicalItemTierEntry {
  readonly id: string;
  readonly tier: PhysicalItemTier;
  readonly rationale: string;
}

const PHYSICAL_ITEM_TIERS: readonly PhysicalItemTierEntry[] = [
  {
    id: 'MedicatedSuture',
    tier: 3,
    // tier 3: crafted from Bicaridine + bandages + advanced kit components.
    // Not roundstart fridge / medibot stock — only appears in end-of-round
    // advanced medkits or when a chemist explicitly assembles the item.
    rationale:
      'Crafted from advanced medkit components; not roundstart medibot stock. Use Brutepack instead unless the medic explicitly has one on hand.',
  },
  {
    id: 'RegenerativeMesh',
    tier: 3,
    // tier 3: same as above — advanced medkit only.
    rationale:
      'Crafted from advanced medkit components; not roundstart medibot stock. Use Ointment / AloeCream instead unless the medic explicitly has one on hand.',
  },
];

const PHYSICAL_TIER_BY_ID: ReadonlyMap<string, PhysicalItemTierEntry> = new Map(
  PHYSICAL_ITEM_TIERS.map((t) => [t.id, t]),
);

export function physicalItemTierFor(itemId: string): PhysicalItemTier {
  return PHYSICAL_TIER_BY_ID.get(itemId)?.tier ?? DEFAULT_PHYSICAL_ITEM_TIER;
}

export function physicalItemTierEntry(
  itemId: string,
): PhysicalItemTierEntry | null {
  return PHYSICAL_TIER_BY_ID.get(itemId) ?? null;
}
