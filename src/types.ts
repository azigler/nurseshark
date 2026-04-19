// Frontend-facing copies of the shapes emitted by src/gen/. Kept decoupled
// from src/gen/types.ts so the runtime bundle doesn't pull in anything from
// the Node-only pipeline (which imports `fs`, `path`, etc.).

export interface ReagentHealEntry {
  readonly target: string;
  readonly kind: 'type' | 'group';
  readonly amountPerTick: number;
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

export interface SolverInput {
  readonly damage: DamageProfile;
  /** Species ID (e.g. `Human`, `Moth`, `Vox`, `Diona`). Required. */
  readonly species: string;
  readonly filters: SolverFilters;
  readonly operatorName?: string;
}

export interface SolverIngredient {
  readonly reagentId: string;
  readonly units: number;
  readonly reason: string;
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
}
