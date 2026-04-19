import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProTipBullet } from '../../data/pro-tips-parser';
import { bulletMatchesFilter, ProTipCallout } from '../ProTipCallout';

function makeBullet(
  tag: ProTipBullet['tag'],
  body: string,
  children: ProTipBullet[] = [],
): ProTipBullet {
  return { tag, body, children };
}

describe('ProTipCallout', () => {
  it('renders the tag label when a tag is set', () => {
    const b = makeBullet('verified-wiki', 'Wiki-sourced tip.');
    const { container, getByText } = render(<ProTipCallout bullet={b} />);
    expect(getByText('[verified-wiki]')).toBeTruthy();
    const root = container.querySelector('.pro-tip');
    expect(root?.className).toContain('pro-tip-verified-wiki');
  });

  it('applies the violet background for verified-wiki', () => {
    const b = makeBullet('verified-wiki', 'Wiki-sourced tip.');
    const { container } = render(<ProTipCallout bullet={b} />);
    const root = container.querySelector('.pro-tip') as HTMLElement | null;
    expect(root).toBeTruthy();
    // Inline style is set via style prop; jsdom normalizes color hex -> rgb.
    const bg = root?.style.background ?? '';
    // Accept either the hex value or its normalized form.
    expect(bg.toLowerCase()).toMatch(/#2a1c3a|rgb\(42,\s*28,\s*58\)/);
  });

  it('uses distinct color for each of the four tags', () => {
    const tags: ProTipBullet['tag'][] = [
      'verified',
      'unverified',
      'new',
      'verified-wiki',
    ];
    const bgs = tags.map((t) => {
      const { container } = render(
        <ProTipCallout bullet={makeBullet(t, 'x')} />,
      );
      const root = container.querySelector('.pro-tip') as HTMLElement | null;
      return root?.style.background ?? '';
    });
    const unique = new Set(bgs);
    expect(unique.size).toBe(4);
  });
});

describe('bulletMatchesFilter', () => {
  it('includes a verified-wiki bullet when the tag is enabled', () => {
    const b = makeBullet('verified-wiki', 'x');
    expect(bulletMatchesFilter(b, new Set(['verified-wiki']))).toBe(true);
    expect(bulletMatchesFilter(b, new Set(['verified']))).toBe(false);
  });

  it('returns true when a child matches even if parent does not', () => {
    const child = makeBullet('verified-wiki', 'child');
    const parent = makeBullet('verified', 'parent', [child]);
    expect(bulletMatchesFilter(parent, new Set(['verified-wiki']))).toBe(true);
  });
});
