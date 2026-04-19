// Color palette for damage types + groups. Keys are both type IDs and group
// IDs, so <DamageBadge type="Heat"> and <DamageBadge type="Burn"> both work.

export interface DamagePalette {
  readonly bg: string;
  readonly fg: string;
  readonly label: string;
}

const GROUP_PALETTE: Record<string, DamagePalette> = {
  Brute: { bg: '#a03838', fg: '#ffe6e6', label: 'Brute' },
  Burn: { bg: '#b8561c', fg: '#ffead0', label: 'Burn' },
  Airloss: { bg: '#2a6fa0', fg: '#dcefff', label: 'Airloss' },
  Toxin: { bg: '#4a8e3a', fg: '#e4f5de', label: 'Toxin' },
  Genetic: { bg: '#7b4aa0', fg: '#ecdcff', label: 'Genetic' },
  Metaphysical: { bg: '#8c7d3a', fg: '#f7efcf', label: 'Metaphysical' },
};

const TYPE_TO_GROUP: Record<string, string> = {
  Blunt: 'Brute',
  Slash: 'Brute',
  Piercing: 'Brute',
  Heat: 'Burn',
  Cold: 'Burn',
  Shock: 'Burn',
  Caustic: 'Burn',
  Asphyxiation: 'Airloss',
  Bloodloss: 'Airloss',
  Poison: 'Toxin',
  Radiation: 'Toxin',
  Cellular: 'Genetic',
  Holy: 'Metaphysical',
  Structural: 'Metaphysical',
};

export function paletteFor(typeOrGroup: string): DamagePalette {
  if (GROUP_PALETTE[typeOrGroup]) {
    return GROUP_PALETTE[typeOrGroup];
  }
  const grp = TYPE_TO_GROUP[typeOrGroup];
  if (grp && GROUP_PALETTE[grp]) {
    // Slightly darker variant for specific types vs. the group color.
    return GROUP_PALETTE[grp];
  }
  return { bg: '#44556a', fg: '#e7eef6', label: typeOrGroup };
}
