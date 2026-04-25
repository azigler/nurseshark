// Hand-curated availability tiers for medicinal reagents (vs-xvp.2).
//
// The Nurseshark solver originally minimized total unit count, which
// surfaced exotic / hard-to-source chems over the basic medical-fridge
// stock the medic actually carries. The tier system encodes the practical
// "what's in arm's reach right now" knowledge:
//
//   - Tier 1 / "fridge stock": cheap, broad-spread, made from raw chem-
//     dispenser elements in one or two reactions. The medic has these
//     pre-made at round start (medibot loadouts, fridge bottles, hypopens).
//   - Tier 2 / "specialized": per-damage-type chems requiring the
//     ChemMaster, hot-plate temperature gates, multi-step recipes, or
//     uncommon precursors. The medic stocks these in smaller quantities
//     and may need a synth run to top up.
//   - Tier 3 / "exotic": rare, multi-system synthesis (botany-derived
//     precursors, salvage drops, syndicate kits, very-deep cryo chains).
//     Recommended only when tier-1 / tier-2 cannot cover the damage.
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
// Radiation even though no tier-1 covers it; Doxarubixadone stays the
// Cellular pick when cryo is on; the user-facing "why" reason explains).

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
 */
export const REAGENT_TIERS: readonly TierEntry[] = [
  // --- Tier 1: roundstart dispenser ---
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

  // --- Tier 2: ChemMaster / temperature gates / multi-step ---
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
    rationale: 'Cold/temp control — copper + fersilicate, plasma catalyst.',
  },
  {
    id: 'Insuzine',
    tier: 2,
    rationale: 'Shock specialist — temp 433K, Leporazine + Kelotane + silicon.',
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
    rationale: 'Histamine/poison reducer — temp 377K, oil-derived precursors.',
  },
  {
    id: 'Cryoxadone',
    tier: 2,
    rationale: 'Cryo-tube broad healer — Dexalin + water + oxygen.',
  },
  {
    id: 'Aloxadone',
    tier: 2,
    rationale: 'Cryo burn — needs botany Aloe + Leporazine + Cryoxadone.',
  },
  {
    id: 'Doxarubixadone',
    tier: 2,
    rationale: 'Cryo cellular — Cryoxadone + unstable mutagen.',
  },
  {
    id: 'Phalanximine',
    tier: 2,
    rationale: 'Cellular damage — Hyronalin + ethanol + mutagen, nerfed pick.',
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
    id: 'Ultravasculine',
    tier: 2,
    rationale: 'Toxin/poison — needs Histamine (injury-derived) + plasma.',
  },
  {
    id: 'Epinephrine',
    tier: 2,
    rationale: 'Crit-stabilizer — phenol + acetone + chlorine + hydroxide.',
  },
  {
    id: 'Psicodine',
    tier: 2,
    rationale: 'Anti-panic — Mannitol + Impedrezene + water.',
  },
  {
    id: 'Cognizine',
    tier: 2,
    rationale:
      'Sentience reagent — needs salvage carpotoxin + botany Siderlac.',
  },
  {
    id: 'Siderlac',
    tier: 2,
    rationale: 'Botany precursor — Aloe + Stellibinin (galaxy thistle).',
  },

  // --- Tier 3: exotic / botany-heavy / multi-system ---
  {
    id: 'Opporozidone',
    tier: 3,
    rationale:
      'Deep cryo — temp 400K, requires Cognizine + Doxarubixadone chain.',
  },
  {
    id: 'Arcryox',
    tier: 3,
    rationale:
      'Exotic broad healer — temp 370K, Tricord + Cryoxadone + lithium.',
  },
  {
    id: 'Ambuzol',
    tier: 3,
    rationale: 'Anti-zombie — Dylovene + ammonia + zombie blood (rare).',
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
    rationale: 'Exotic — Desoxyephedrine (meth) + Stellibinin.',
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
  {
    id: 'Charcoal',
    tier: 2,
    rationale:
      'Antidote — heals 1 Poison/tick; ranks below Dylovene & friends.',
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
