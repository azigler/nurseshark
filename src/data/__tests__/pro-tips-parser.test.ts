import { describe, expect, it } from 'vitest';
import proTipsSource from '../pro-tips.md?raw';
import {
  collectTags,
  type ProTipBullet,
  parseProTips,
} from '../pro-tips-parser';

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

  it('includes the wiki-canonical sections', () => {
    const names = doc.sections.map((s) => s.heading);
    expect(names).toContain('Triage and revival');
    expect(names).toContain('Stasis bed');
    expect(names).toContain('Bleeding and blood loss');
    expect(names).toContain('Sources');
  });

  it('extracts tags on bullets', () => {
    const tags = collectTags(doc);
    expect(tags.has('verified')).toBe(true);
    expect(tags.has('unverified')).toBe(true);
    expect(tags.has('new')).toBe(true);
    expect(tags.has('verified-wiki')).toBe(true);
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

  it('strips [verified-wiki] tag (longer tag wins over [verified])', () => {
    // Collect all bullets with verified-wiki tag and check body doesn't
    // start with the tag (the parser must match verified-wiki before
    // verified to avoid leaving `-wiki]` dangling).
    const collectAll = (bullets: readonly ProTipBullet[]): ProTipBullet[] => {
      const out: ProTipBullet[] = [];
      for (const b of bullets) {
        out.push(b, ...collectAll(b.children));
      }
      return out;
    };
    const all: ProTipBullet[] = [];
    for (const s of doc.sections) {
      all.push(...collectAll(s.bullets));
      for (const sub of s.subsections) {
        all.push(...collectAll(sub.bullets));
      }
    }
    const wikiBullets = all.filter((b) => b.tag === 'verified-wiki');
    expect(wikiBullets.length).toBeGreaterThanOrEqual(5);
    for (const b of wikiBullets) {
      expect(b.body).not.toContain('[verified-wiki]');
      expect(b.body).not.toContain('-wiki]');
      expect(b.body.startsWith('[')).toBe(false);
    }
  });

  it('Triage section has at least the two Medical-page bullets', () => {
    const triage = doc.sections.find((s) => s.heading === 'Triage and revival');
    expect(triage).toBeTruthy();
    const wikiBullets = (triage?.bullets ?? []).filter(
      (b) => b.tag === 'verified-wiki',
    );
    expect(wikiBullets.length).toBeGreaterThanOrEqual(2);
  });

  it('Sources section links the four wiki pages', () => {
    const sources = doc.sections.find((s) => s.heading === 'Sources');
    expect(sources).toBeTruthy();
    const joined = (sources?.bullets ?? []).map((b) => b.body).join('\n');
    expect(joined).toContain('wiki.spacestation14.com/wiki/Medical');
    expect(joined).toContain('Guide_to_Medical');
    expect(joined).toContain('Chemicals');
    expect(joined).toContain('Medibot');
  });
});
