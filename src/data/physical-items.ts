// Physical medical items the Nurseshark solver can recommend. These are NOT
// in the YAML-sourced data pipeline (which only covers reagents, reactions,
// damage types, species, containers) — they're hand-modeled here from the
// SS14 YAML at Resources/Prototypes/Entities/Objects/Specific/Medical/.
//
// Keep this list pragmatic: small, focused on items a medic actually uses in
// the field. Damage-type coverage + per-application amounts are best-effort
// estimates aligned with in-game behavior. If amounts drift vs game data,
// update here; the solver consumes `healsPerApplication` directly.

export interface PhysicalItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Damage-type → total heal delivered per single application. */
  readonly healsPerApplication: Readonly<Record<string, number>>;
  /**
   * Whether this item restores Blood level via iron-metabolism (true) or via
   * a species-agnostic mechanism (false). Blood Packs in SS14 transfuse
   * actual blood, which is species-specific — we flag true so the Moth/Vox/
   * Diona overlay can swap them out.
   */
  readonly ironMetabolism?: boolean;
}

export const PHYSICAL_ITEMS: readonly PhysicalItem[] = [
  {
    id: 'Bandage',
    name: 'Bandage',
    description: 'Staunches Bloodloss and soothes some Blunt bruising.',
    healsPerApplication: { Bloodloss: 10, Blunt: 5 },
  },
  {
    id: 'Gauze',
    name: 'Gauze',
    description: 'Absorbent gauze — primarily for Bloodloss control.',
    healsPerApplication: { Bloodloss: 15 },
  },
  {
    id: 'Ointment',
    name: 'Ointment',
    description: 'Topical salve for Heat-related burns.',
    healsPerApplication: { Heat: 10 },
  },
  {
    id: 'RegenerativeMesh',
    name: 'Regenerative Mesh',
    description: 'Advanced burn dressing — covers Heat and Shock damage.',
    healsPerApplication: { Heat: 15, Shock: 10 },
  },
  {
    id: 'MedicatedSuture',
    name: 'Medicated Suture',
    description: 'Closes brute wounds — Blunt, Piercing, Slash.',
    healsPerApplication: { Blunt: 10, Piercing: 10, Slash: 10 },
  },
  {
    id: 'BloodPack',
    name: 'Blood Pack',
    description: 'Transfusion unit. Species-specific blood type required.',
    healsPerApplication: { Bloodloss: 50 },
    ironMetabolism: true,
  },
];

export const PHYSICAL_ITEMS_BY_ID: ReadonlyMap<string, PhysicalItem> = new Map(
  PHYSICAL_ITEMS.map((i) => [i.id, i]),
);
