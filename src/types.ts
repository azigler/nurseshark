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

/** Shape returned by the solver `computeMix` function. vs-2wj owns the real impl. */
export interface SolverInput {
  readonly target: string;
  readonly units: number;
  readonly operatorName?: string;
}

export interface SolverStep {
  readonly kind: 'mix' | 'heat' | 'cool' | 'transfer' | 'note';
  readonly text: string;
}

export interface SolverIngredient {
  readonly reagentId: string;
  readonly units: number;
}

export interface SolverOutput {
  readonly ingredients: readonly SolverIngredient[];
  readonly steps: readonly SolverStep[];
  readonly warnings: readonly string[];
  readonly label: string;
  /** True only when a real impl has computed this. Stub always returns false. */
  readonly solved: boolean;
}
