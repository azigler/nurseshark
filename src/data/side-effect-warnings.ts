// Hand-authored wiki-voice side-effect warnings, keyed by reagent id. The
// solver folds these into every picked ingredient's `sideEffectWarnings[]`.
//
// Purpose: the data pipeline (`src/gen/resolve-reagents.ts`) extracts
// SIDE-EFFECTS and CONDITIONAL HEALS in structured form, but the prose that
// surfaces them needs to match the medic-wiki tone and call out the
// appropriate pairing ("budget bicaridine", "top up with Tricordrazine") that
// the raw data doesn't carry.
//
// Two categories of entries:
//   - `static`: always included when the reagent is picked (Ultravasculine
//     brute, Arithrazine brute). Derived from `sideEffects[]` where possible
//     but enriched with the wiki's recommended countermeasure.
//   - `dynamic` (computed by the solver): conditional warnings whose trigger
//     depends on the patient profile (Tricord <50 when damage ≥ 50, Epi
//     non-critical, Dermaline near OD).
//
// We deliberately key on reagent id rather than a pattern match: wiki voice
// varies, and the cross-references ("pair with bicaridine") are hand-picked.
// Adding a new warning is a one-liner here — no solver code changes needed.

export interface StaticWarning {
  /** Always surfaced when this reagent is picked. */
  readonly text: string;
}

/**
 * Static, unconditional warnings — these apply any time the solver picks
 * the reagent, because the side-effect IS the defining feature of the
 * reagent (Ultravasculine / Arithrazine deal brute as the cost of their
 * niche detox/radiation healing).
 */
export const STATIC_WARNINGS: Readonly<Record<string, StaticWarning>> = {
  Ultravasculine: {
    text: 'Ultravasculine: deals 1.5 Blunt per tick alongside detox (6/tick below 20u, 2/tick above 20u). Budget Bicaridine to compensate.',
  },
  Arithrazine: {
    text: 'Arithrazine: deals 1.5 Blunt per tick while curing 3 Radiation/tick. Pair with Bicaridine.',
  },
};

/**
 * Ids of reagents whose heal is gated on the patient being in a specific
 * state. Used by the solver to emit advisory warnings that reference the
 * actual input profile (e.g. "total damage ≥50, Tricord won't fire").
 */
export const CONDITIONAL_HEAL_IDS: ReadonlySet<string> = new Set([
  'Tricordrazine',
  'Epinephrine',
]);

/**
 * OD-proximity warnings for reagents where the wiki calls out a specific
 * syringe/top-up pattern. Keyed by reagent id; the solver fires the warning
 * when the picked dose is within `nearOdMargin` units of the OD threshold.
 */
export interface OdProximityWarning {
  readonly nearOdMargin: number;
  readonly text: string;
}

export const OD_PROXIMITY_WARNINGS: Readonly<
  Record<string, OdProximityWarning>
> = {
  Dermaline: {
    nearOdMargin: 0, // Fire as soon as the picked dose >= OD - 0 (i.e. at or above OD).
    text: 'Dermaline: max safe dose 10u; syringe holds 15u — top up remaining 5u with Tricordrazine.',
  },
};

/**
 * Extra hand-authored phrasing for conditional-heal warnings. Keyed by
 * reagent id; the solver picks between these based on the patient profile.
 */
export const CONDITIONAL_HEAL_WARNINGS: Readonly<
  Record<
    string,
    { readonly tricordHighDamage?: string; readonly epiNonCritical?: string }
  >
> = {
  Tricordrazine: {
    tricordHighDamage:
      'Tricordrazine only heals below 50 total damage. With this profile the Brute/Burn heal will not fire — monitor after administration or switch to a dedicated brute/burn med.',
  },
  Epinephrine: {
    epiNonCritical:
      'Epinephrine heals Brute/Burn/Poison ONLY when the patient is in a critical state. For non-crit patients, use direct meds (Bicaridine for Brute, Dermaline for Burn, Ultravasculine/Arithrazine for Poison/Radiation).',
  },
};
