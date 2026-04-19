// Curated list of reagents that are NOT reachable via player-facing chemistry,
// but DO appear in the reagent dataset. The solver hides them from candidate
// ranking by default (so it doesn't recommend mixes a chemist can't actually
// make), and the reagent browser hides them behind the "Show admin / rare
// reagents" toggle.
//
// See `scripts/sweep-unreachable-reagents.ts` for the regeneration workflow.
// The sweep finds reagents with no reaction producing them; this module is
// the hand-curated subset of that sweep that (a) would otherwise confuse a
// medic (Medicine/Biological groups with heals[] entries) or (b) is
// explicitly admin/rare according to game knowledge (wiki, prototypes).
//
// IMPORTANT: we do NOT blacklist dangerous-but-craftable chems. Razorium,
// Meth, Lexorin, Heartbreaker Toxin, Nocturine, Hyperzine — all valid
// outputs in niche scenarios (adversarial, self-harm, etc). They stay
// visible; the reason-tag system lets the UI differentiate elsewhere.
//
// We also deliberately leave "unreachable but obvious" reagents (raw
// Elements, juices, blood, alcohols) off the blacklist. A medic looking at
// the browser expects to see Iron/Aluminium/etc.; hiding them adds no
// value. The blacklist is scoped to *medically confusing* unreachables —
// things a medic might think "oh I should craft this" about.

export type BlacklistReason =
  | 'uncraftable'
  | 'admin-only'
  | 'syndicate-only'
  | 'botany-only'
  | 'special-event'
  | 'other';

export interface BlacklistEntry {
  readonly id: string;
  readonly reason: BlacklistReason;
  readonly notes: string;
}

export const REAGENT_BLACKLIST: readonly BlacklistEntry[] = [
  // --- Heals-carrying unreachables (the main solver bug from vs-3il.3). ---
  {
    id: 'Rororium',
    reason: 'uncraftable',
    notes:
      'Admin-spawn Biological reagent. Heals 4 Brute/tick + 120s adrenaline. No reaction produces it.',
  },
  {
    id: 'Omnizine',
    reason: 'uncraftable',
    notes:
      'Medicine group; heals Brute/Burn/Toxin/Airloss at 2/tick. Wiki: "cannot be made with chemicals." Admin-spawn or boss-drop only.',
  },
  {
    id: 'PolypyryliumOligomers',
    reason: 'uncraftable',
    notes:
      'Medicine group; heals Brute 1.75/tick + Airloss 1/tick. No reaction produces it (world-spawn only).',
  },
  {
    id: 'Stellibinin',
    reason: 'uncraftable',
    notes:
      'Medicine group; heals Poison 4/tick (star-cap Amatoxin antidote). Derived from star-cap mushrooms via botany, not chemistry.',
  },
  {
    id: 'Ichor',
    reason: 'uncraftable',
    notes:
      'Biological reagent from Diona/plant mobs. Heals Brute/Burn/Toxin/Bloodloss. Treated specially by species-overlay for Diona; generally unreachable via chemistry.',
  },

  // --- Medically confusing non-heals (Medicine/admin group, no heals[]).
  {
    id: 'Barozine',
    reason: 'uncraftable',
    notes:
      'Medicine group, pressure-stabilizer. No reaction produces it; admin-spawn only.',
  },
  {
    id: 'PulpedBananaPeel',
    reason: 'botany-only',
    notes:
      'Medicine group, derived from pulping banana peels (tool, not chemistry).',
  },
  {
    id: 'Artifexium',
    reason: 'special-event',
    notes:
      'Artifact-interaction reagent (Science/xenoarch). Not produced by chemistry.',
  },
];

/** Efficient membership check. */
const BLACKLIST_IDS: ReadonlySet<string> = new Set(
  REAGENT_BLACKLIST.map((e) => e.id),
);

const BLACKLIST_BY_ID: ReadonlyMap<string, BlacklistEntry> = new Map(
  REAGENT_BLACKLIST.map((e) => [e.id, e]),
);

export function isBlacklisted(reagentId: string): boolean {
  return BLACKLIST_IDS.has(reagentId);
}

export function blacklistEntry(reagentId: string): BlacklistEntry | null {
  return BLACKLIST_BY_ID.get(reagentId) ?? null;
}
