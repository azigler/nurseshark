// Frontend-facing copies of the shapes emitted by src/gen/. Kept decoupled
// from src/gen/types.ts so the runtime bundle doesn't pull in anything from
// the Node-only pipeline (which imports `fs`, `path`, etc.).

export interface ReagentHealEntry {
  readonly target: string;
  readonly kind: 'type' | 'group';
  readonly amountPerTick: number;
}

/**
 * Side-effect a reagent inflicts (positive-delta damage, or a status-effect
 * gate like Vomit/Jitter/Drowsiness). Mirror of the pipeline's
 * `OutReagentSideEffect`. See vs-3il.5.
 */
export interface ReagentSideEffect {
  readonly type: 'damage' | 'status';
  readonly target: string;
  readonly kind: 'type' | 'group' | 'status';
  readonly amount: number;
  /** e.g. `"above 15u"`, or null if unconditional. */
  readonly condition: string | null;
}

/**
 * A heal that fires only in a specific patient state (MobState Critical,
 * TotalDamage < 50). Rendered as advisory text; not folded into dose math.
 */
export interface ReagentConditionalHeal {
  readonly target: string;
  readonly kind: 'type' | 'group';
  readonly amountPerTick: number;
  readonly condition: string;
}

export interface Reagent {
  readonly id: string;
  /** Fluent key (e.g. "reagent-name-bicaridine") or, for a few legacy records, a plain name. */
  readonly name: string;
  readonly desc: string | null;
  readonly physicalDesc: string | null;
  readonly color: string | null;
  readonly group: string | null;
  readonly metabolismRate: number;
  readonly conflictsWith: readonly string[];
  readonly heals: readonly ReagentHealEntry[];
  /** Damage the reagent inflicts + status-effect gates (vs-3il.5). */
  readonly sideEffects: readonly ReagentSideEffect[];
  /** Heals gated on patient state (Epi crit-only, Tricord <50) (vs-3il.5). */
  readonly conditionalHeals: readonly ReagentConditionalHeal[];
  readonly effects: readonly unknown[];
  readonly spritesheetIndex: string | null;
}

export interface ReactionComponent {
  readonly id: string;
  readonly amount: number;
}

export interface Reaction {
  readonly id: string;
  readonly reactants: readonly ReactionComponent[];
  readonly catalysts: readonly ReactionComponent[];
  readonly products: readonly ReactionComponent[];
  readonly minTemp: number | null;
  readonly maxTemp: number | null;
  readonly impact: string | null;
  readonly conflictsWith: readonly string[];
}

export interface DamageType {
  readonly id: string;
  readonly nameKey: string | null;
  readonly group: string | null;
  readonly treatable: boolean;
  readonly reagentsThatHeal: readonly string[];
}

export interface Species {
  readonly id: string;
  readonly nameKey: string | null;
  readonly prototype: string | null;
  readonly notes: string | null;
}

export interface Container {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly capacityU: number | null;
  readonly maxReagents: number | null;
  readonly spritesheetIndex: string | null;
}

export interface Meta {
  readonly ss14CommitSha: string | null;
  readonly nursesharkVersion: string;
  readonly builtAt: string;
  readonly sourcePath: string;
}

export interface SpriteManifestEntry {
  readonly path: string;
  readonly w: number;
  readonly h: number;
}

export type FluentDict = Readonly<Record<string, string>>;
export type SpriteManifest = Readonly<Record<string, SpriteManifestEntry>>;

/**
 * Physical medical item (Bandage, Gauze, Ointment, Regenerative Mesh,
 * Medicated Suture, Blood Pack, Tourniquet, etc). Loaded from
 * `public/data/physical-items.json`, extracted at build time from the VS14
 * YAML. See `src/gen/resolve-physical-items.ts` for the source of truth.
 */
export interface PhysicalItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly healsPerApplication: Readonly<Record<string, number>>;
  readonly damagePenalty: Readonly<Record<string, number>>;
  readonly bloodlossModifier: number;
  readonly modifyBloodLevel: number;
  readonly stackSize: number;
  readonly ironMetabolism: boolean;
  readonly sourcePrototypeFile: string;
}

/**
 * Damage-driven solver input. Mirrors a health-scanner readout: damage
 * amounts per treatable type, a species selector, three filter checkboxes
 * for output composition, and an optional operator name for the label.
 *
 * Holy damage is intentionally excluded — it's the chaplain's domain, not
 * Nurseshark's (see DECISIONS/OQ-4 on vs-2wj).
 */
export interface DamageProfile {
  readonly Blunt?: number;
  readonly Piercing?: number;
  readonly Slash?: number;
  readonly Heat?: number;
  readonly Cold?: number;
  readonly Shock?: number;
  readonly Poison?: number;
  readonly Caustic?: number;
  readonly Cellular?: number;
  readonly Radiation?: number;
  readonly Bloodloss?: number;
  readonly Asphyxiation?: number;
}

export type DamageTypeId = keyof DamageProfile;

export interface SolverFilters {
  readonly chems: boolean;
  readonly physical: boolean;
  readonly cryo: boolean;
}

/**
 * Patient state at the time of the scan. Drives solver behavior:
 *
 *  - `"alive"` (default): standard chem + physical + cryo plan; no revival step.
 *  - `"critical"`: same plan shape as alive; the solver does NOT inject a
 *    defib step, but surfaces any conditional-heal advisories that depend on
 *    the patient being in a critical state (Epi notably).
 *  - `"dead"`: revival flow. Chemicals don't metabolize in corpses, so the
 *    primary pick is topicals-only, scaled to reduce projected total damage
 *    below 200 (the in-game defibrillator threshold). Then the solver emits a
 *    distinct `revivalStep` (defibrillator use) and a follow-up chem mix
 *    (`postRevivalIngredients`) for the implicitly-critical post-revival state.
 */
export type PatientState = 'alive' | 'critical' | 'dead';

export interface SolverInput {
  readonly damage: DamageProfile;
  /** Species ID (e.g. `Human`, `Moth`, `Vox`, `Diona`). Required. */
  readonly species: string;
  readonly filters: SolverFilters;
  readonly operatorName?: string;
  /**
   * When true, candidates in `REAGENT_BLACKLIST` are NOT excluded. Default
   * false — the solver skips admin-spawn / uncraftable reagents (Rororium,
   * Omnizine, etc.) so its output is actually makeable by a chemist.
   */
  readonly includeRestricted?: boolean;
  /**
   * Patient state. Default `"alive"`. See `PatientState` for the dead-mode
   * revival flow (vs-3il.6).
   */
  readonly patientState?: PatientState;
}

export interface SolverIngredient {
  readonly reagentId: string;
  readonly units: number;
  readonly reason: string;
  /**
   * Per-ingredient advisory strings (wiki-voice) explaining side-effects,
   * conditional heals, and dose-cap caveats the solver can't fully model.
   * Rendered near the ingredient line in the UI; duplicates of these also
   * appear on the reagent detail page. See vs-3il.5 + `side-effect-warnings.ts`.
   */
  readonly sideEffectWarnings: readonly string[];
  /**
   * Availability tier of the reagent (vs-xvp.2):
   *   1 = fridge stock / roundstart dispenser (medic has it pre-made)
   *   2 = chemmaster / multi-step / specialized
   *   3 = exotic / botany / admin / very rare
   * Surfaced in the UI as a badge so the medic sees "I already have this"
   * vs "I need a synth run" at a glance.
   */
  readonly tier: 1 | 2 | 3;
  /**
   * Wiki-voice "why" reason rendered when `tier > 1` was necessary — i.e.
   * the lower-tier alternatives could not cover the damage profile, so the
   * solver had to escalate. `null` when the pick was tier 1 (no escalation
   * needed) or when escalation was for a non-damage reason (species overlay,
   * cryo, etc.).
   */
  readonly tierReason: string | null;
}

export interface SolverPhysicalEntry {
  readonly itemId: string;
  readonly count: number;
  readonly reason: string;
}

export interface SolverCryoEntry {
  readonly reagentId: string;
  readonly units: number;
  /** Kelvin — cryo tube target temperature. */
  readonly targetTemp: number;
  readonly reason: string;
}

/**
 * Discrete defibrillation step in the dead-patient revival flow. Rendered as
 * its own panel between topicals and post-revival chems — distinct from the
 * ingredients list because a defibrillator is an item, not a reagent. See
 * vs-3il.6.
 */
export interface SolverRevivalStep {
  readonly tool: 'defibrillator';
  /** Damage healed by the shock (Asphyxiation: 40 in current data). */
  readonly heals: Partial<DamageProfile>;
  /** Damage inflicted as a side-effect (Shock: 5 in current data). */
  readonly inflicts: Partial<DamageProfile>;
  /** Operator-facing wiki-voice note, e.g. "Press Z to activate, then use on patient." */
  readonly note: string;
}

export interface SolverOutput {
  readonly ingredients: readonly SolverIngredient[];
  readonly physical: readonly SolverPhysicalEntry[];
  readonly cryo: SolverCryoEntry | null;
  readonly warnings: readonly string[];
  /** Pre-built copyable label per pro-tips format. */
  readonly label: string;
  /** Rough estimate (seconds) to fully metabolize the prescribed treatment. */
  readonly estimatedTimeSec: number | null;
  /** True when the solver has produced a usable recipe. False = nothing to render. */
  readonly solved: boolean;
  /**
   * Defibrillation step, emitted ONLY when `patientState === "dead"` and a
   * revival is projected to succeed (topicals got total damage below 200).
   * See vs-3il.6.
   */
  readonly revivalStep?: SolverRevivalStep;
  /**
   * Post-revival chem mix, emitted ONLY when `patientState === "dead"`. The
   * solver projects the post-defib damage profile (original − topical heals
   * − revivalStep.heals + revivalStep.inflicts) and re-runs itself with
   * `patientState: "critical"` to produce a follow-up chem plan. Side-effect
   * warnings come through the same vs-3il.5 system. See vs-3il.6.
   */
  readonly postRevivalIngredients?: readonly SolverIngredient[];
  /**
   * Warnings specific to dead/critical modes — e.g. "Patient cannot be
   * revived via available topicals; consult CMO." Kept separate from
   * `warnings[]` so the UI can render them in the revival-flow panel
   * (high-visibility) vs the standard mix warnings (low-priority advisory).
   * See vs-3il.6.
   */
  readonly patientStateWarnings?: readonly string[];
}
