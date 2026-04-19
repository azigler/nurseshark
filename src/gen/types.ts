// Shared TypeScript types for the nurseshark data pipeline.
// These describe both the SS14 YAML shape (as parsed) and the output JSON
// artifacts under public/data/.

// ---------------- Raw SS14 YAML shapes ----------------

/** A `!type:X` tag gets flattened to { __type: 'X', ...rest } by our loader. */
export type Tagged<T extends string = string> = { __type: T } & Record<
  string,
  unknown
>;

export interface RawReagentPrototype {
  readonly type: 'reagent';
  readonly id: string;
  readonly name?: string;
  readonly desc?: string;
  readonly physicalDesc?: string;
  readonly color?: string;
  readonly group?: string;
  readonly parent?: string | string[];
  readonly abstract?: boolean;
  readonly metabolisms?: Record<string, RawMetabolismGroup>;
  readonly flavor?: string;
}

export interface RawMetabolismGroup {
  readonly metabolismRate?: number;
  readonly effects?: readonly Tagged[];
}

export interface RawReactionPrototype {
  readonly type: 'reaction';
  readonly id: string;
  readonly reactants?: Record<string, { amount?: number; catalyst?: boolean }>;
  readonly products?: Record<string, number>;
  readonly minTemp?: number;
  readonly maxTemp?: number;
  readonly impact?: string;
  readonly effects?: readonly Tagged[];
  readonly quantized?: boolean;
}

export interface RawDamageTypePrototype {
  readonly type: 'damageType';
  readonly id: string;
  readonly name?: string;
  readonly armorCoefficientPrice?: number;
  readonly armorFlatPrice?: number;
}

export interface RawDamageGroupPrototype {
  readonly type: 'damageGroup';
  readonly id: string;
  readonly name?: string;
  readonly damageTypes?: readonly string[];
}

export interface RawDamageModifierSetPrototype {
  readonly type: 'damageModifierSet';
  readonly id: string;
  readonly coefficients?: Record<string, number>;
  readonly flatReductions?: Record<string, number>;
}

export interface RawSpeciesPrototype {
  readonly type: 'species';
  readonly id: string;
  readonly name?: string;
  readonly roundStart?: boolean;
  readonly prototype?: string;
  readonly skinColoration?: string;
  readonly defaultSkinTone?: string;
}

export interface RawEntityPrototype {
  readonly type: 'entity';
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly parent?: string | string[];
  readonly abstract?: boolean;
  readonly suffix?: string;
  readonly components?: ReadonlyArray<
    Record<string, unknown> & { type: string }
  >;
}

// ---------------- Output JSON shapes (consumed by frontend + solver) ----------------

export interface OutReagentHealEntry {
  /** Damage type ID (e.g. `Blunt`, `Poison`) — or a damage group ID (e.g. `Brute`). */
  readonly target: string;
  /** Is `target` a damage group (expands to multiple types) or a single type? */
  readonly kind: 'type' | 'group';
  /** Positive => healing. Absolute per-tick value (original YAML is negative for heal). */
  readonly amountPerTick: number;
}

export interface OutReagent {
  readonly id: string;
  /** Resolved display name if available, otherwise the fluent key. */
  readonly name: string;
  readonly desc: string | null;
  readonly physicalDesc: string | null;
  readonly color: string | null;
  readonly group: string | null;
  /** Bloodstream metabolism rate (u/tick). Default 0.5 if absent. */
  readonly metabolismRate: number;
  /** Reagents whose simultaneous presence with this one produces Razorium. */
  readonly conflictsWith: readonly string[];
  /** Flattened HealthChange list, absolute value. */
  readonly heals: readonly OutReagentHealEntry[];
  /** The raw Bloodstream effects list (minimally processed). */
  readonly effects: readonly unknown[];
  readonly spritesheetIndex: string | null;
}

export interface OutReactionComponent {
  readonly id: string;
  readonly amount: number;
}

export interface OutReaction {
  readonly id: string;
  readonly reactants: readonly OutReactionComponent[];
  readonly catalysts: readonly OutReactionComponent[];
  readonly products: readonly OutReactionComponent[];
  readonly minTemp: number | null;
  readonly maxTemp: number | null;
  readonly impact: string | null;
  /** If this reaction produces Razorium, the (sorted) unique pair of reactants that triggered it. */
  readonly conflictsWith: readonly string[];
}

export interface OutDamageType {
  readonly id: string;
  readonly nameKey: string | null;
  readonly group: string | null;
  /** True if at least one reagent heals this damage type, and it's not metaphysical (e.g. Holy). */
  readonly treatable: boolean;
  readonly reagentsThatHeal: readonly string[];
}

export interface OutSpecies {
  readonly id: string;
  readonly nameKey: string | null;
  readonly prototype: string | null;
  /** Plain-text narrative from Guidebook/Mobs/<Id>.xml, BBCode stripped. */
  readonly notes: string | null;
}

export interface OutContainer {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly capacityU: number | null;
  readonly maxReagents: number | null;
  readonly spritesheetIndex: string | null;
}

export interface OutMeta {
  readonly ss14CommitSha: string | null;
  readonly nursesharkVersion: string;
  readonly builtAt: string;
  readonly sourcePath: string;
}

export interface SpriteManifestEntry {
  /** Relative path under public/data/ — e.g. `sprites/containers/Jug.png` or `sprites/reagents/Bicaridine.png`. */
  readonly path: string;
  readonly w: number;
  readonly h: number;
}
