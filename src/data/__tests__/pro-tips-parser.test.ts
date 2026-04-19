import { describe, expect, it } from 'vitest';
import proTipsSource from '../pro-tips.md?raw';
import { collectTags, parseProTips } from '../pro-tips-parser';

describe('parseProTips', () => {
  const doc = parseProTips(proTipsSource);

  it('extracts frontmatter title', () => {
    expect(doc.frontmatter.title).toBe('Nurseshark Pro Tips');
  });

  it('finds top-level sections', () => {
    const names = doc.sections.map((s) => s.heading);
    expect(names).toContain('Brute-med discipline');
    expect(names).toContain('Cryo workflow');
  });

  it('extracts tags on bullets', () => {
    const tags = collectTags(doc);
    expect(tags.has('verified')).toBe(true);
    expect(tags.has('unverified')).toBe(true);
    expect(tags.has('new')).toBe(true);
  });

  it('finds Vox subsection under species', () => {
    const species = doc.sections.find((s) =>
      s.heading.toLowerCase().includes('species-specific'),
    );
    expect(species).toBeTruthy();
    const voxSub = species?.subsections.find((s) =>
      s.heading.toLowerCase().includes('vox'),
    );
    expect(voxSub).toBeTruthy();
    expect(voxSub?.bullets.length).toBeGreaterThan(0);
  });

  it('strips [verified]/[new] tag from bullet body', () => {
    // Find a bullet known to have [verified] prefix.
    for (const s of doc.sections) {
      for (const b of s.bullets) {
        if (b.tag === 'verified') {
          expect(b.body.startsWith('[verified]')).toBe(false);
          return;
        }
      }
    }
  });
});
