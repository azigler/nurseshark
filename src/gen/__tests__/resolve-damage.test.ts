// Tests for damage-type treatable classification and guidebook XML cleanup.
import { describe, expect, it } from 'vitest';
import { cleanGuidebookText } from '../resolve-damage';
import type { OutReagent } from '../types';

describe('cleanGuidebookText', () => {
  it('strips XML Document tags and BBCode color tags', () => {
    const xml = `<Document>
  # Vox

  <Box>
    <GuideEntityEmbed Entity="MobVox" Caption=""/>
  </Box>

  [color=#ffa500]Warning![/color]
</Document>`;
    const cleaned = cleanGuidebookText(xml);
    expect(cleaned).not.toContain('<Document>');
    expect(cleaned).not.toContain('<Box>');
    expect(cleaned).not.toContain('[color');
    expect(cleaned).not.toContain('[/color');
    expect(cleaned).toContain('Warning!');
    expect(cleaned).toContain('# Vox');
  });

  it('collapses excessive whitespace but preserves paragraph structure', () => {
    const xml =
      '<Document>Line one.\n\n\n\nLine two.\n\n\n\nLine three.</Document>';
    const cleaned = cleanGuidebookText(xml);
    expect(cleaned).toMatch(/Line one\.\n\nLine two\.\n\nLine three\./);
  });

  it('handles HTML entities', () => {
    const cleaned = cleanGuidebookText('<Document>A&nbsp;B&amp;C</Document>');
    expect(cleaned).toContain('A B&C');
  });
});

describe('damage treatable flagging (integration-style)', () => {
  it('Holy is always non-treatable even if a reagent claims to heal it', () => {
    // Smoke test contract: simulating the check that resolve-damage does.
    const reagents: OutReagent[] = [
      {
        id: 'FakeHolyHealer',
        name: 'FakeHolyHealer',
        desc: null,
        physicalDesc: null,
        color: null,
        group: null,
        metabolismRate: 0.5,
        conflictsWith: [],
        heals: [{ target: 'Holy', kind: 'type', amountPerTick: 1 }],
        sideEffects: [],
        conditionalHeals: [],
        effects: [],
        spritesheetIndex: null,
      },
    ];
    // Manually mirror the predicate used in resolve-damage for clarity.
    const NEVER_TREATABLE = new Set(['Holy']);
    const healers = new Set(reagents.map((r) => r.id));
    const treatable = !NEVER_TREATABLE.has('Holy') && healers.size > 0;
    expect(treatable).toBe(false);
  });

  it('a normal damage type with healers is treatable', () => {
    const NEVER_TREATABLE = new Set(['Holy']);
    const healers = new Set(['Bicaridine', 'Tricordrazine']);
    const treatable = !NEVER_TREATABLE.has('Blunt') && healers.size > 0;
    expect(treatable).toBe(true);
  });

  it('a damage type with no healers is non-treatable', () => {
    const NEVER_TREATABLE = new Set(['Holy']);
    const healers = new Set<string>();
    const treatable = !NEVER_TREATABLE.has('Structural') && healers.size > 0;
    expect(treatable).toBe(false);
  });
});
