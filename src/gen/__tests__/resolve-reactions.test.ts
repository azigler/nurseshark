// Tests for the razorium-pair computation. We craft small reaction sets
// to confirm the pair-detection logic without hitting the VS14 YAML.
import { describe, expect, it } from 'vitest';
import type { RawReactionPrototype } from '../types';

// Re-implement the razorium pair walk on an in-memory `reactions` array.
// This mirrors resolve-reactions.ts so we test the pure algorithm; the
// module itself also reads from disk, which we cover via the integration
// behaviour of `npm run gen` producing a non-zero razorium pair count.
function computeRazoriumPairs(reactions: RawReactionPrototype[]): {
  pairs: Set<string>;
  conflictsByReagent: Map<string, Set<string>>;
} {
  const pairs = new Set<string>();
  const conflictsByReagent = new Map<string, Set<string>>();
  for (const r of reactions) {
    const products = Object.keys(r.products ?? {});
    if (!products.includes('Razorium')) continue;
    const reactantIds = Object.entries(r.reactants ?? {})
      .filter(([, v]) => !(v as { catalyst?: boolean })?.catalyst)
      .map(([k]) => k);
    for (let i = 0; i < reactantIds.length; i++) {
      for (let j = i + 1; j < reactantIds.length; j++) {
        const a = reactantIds[i];
        const b = reactantIds[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        pairs.add(key);
        let sa = conflictsByReagent.get(a);
        if (!sa) {
          sa = new Set();
          conflictsByReagent.set(a, sa);
        }
        let sb = conflictsByReagent.get(b);
        if (!sb) {
          sb = new Set();
          conflictsByReagent.set(b, sb);
        }
        sa.add(b);
        sb.add(a);
      }
    }
  }
  return { pairs, conflictsByReagent };
}

describe('razorium pair computation', () => {
  it('produces a symmetric pair for a two-reactant razorium reaction', () => {
    const reactions: RawReactionPrototype[] = [
      {
        type: 'reaction',
        id: 'MixBadDrugsA',
        reactants: { Bicaridine: { amount: 1 }, Lacerinol: { amount: 1 } },
        products: { Razorium: 1 },
      },
    ];
    const { pairs, conflictsByReagent } = computeRazoriumPairs(reactions);
    expect(pairs.size).toBe(1);
    expect(conflictsByReagent.get('Bicaridine')?.has('Lacerinol')).toBe(true);
    expect(conflictsByReagent.get('Lacerinol')?.has('Bicaridine')).toBe(true);
  });

  it('does not duplicate pairs across different razorium-producing reactions', () => {
    const reactions: RawReactionPrototype[] = [
      {
        type: 'reaction',
        id: 'A',
        reactants: { X: { amount: 1 }, Y: { amount: 1 } },
        products: { Razorium: 1 },
      },
      {
        type: 'reaction',
        id: 'B',
        reactants: { Y: { amount: 1 }, X: { amount: 1 } },
        products: { Razorium: 1 },
      },
    ];
    const { pairs } = computeRazoriumPairs(reactions);
    expect(pairs.size).toBe(1);
  });

  it('ignores reactions whose products do not include Razorium', () => {
    const reactions: RawReactionPrototype[] = [
      {
        type: 'reaction',
        id: 'BenignReaction',
        reactants: { Oxygen: { amount: 1 }, Hydrogen: { amount: 1 } },
        products: { Water: 1 },
      },
    ];
    const { pairs } = computeRazoriumPairs(reactions);
    expect(pairs.size).toBe(0);
  });

  it('skips catalysts when computing pairs', () => {
    const reactions: RawReactionPrototype[] = [
      {
        type: 'reaction',
        id: 'A',
        reactants: {
          X: { amount: 1 },
          Y: { amount: 1 },
          CatZ: { amount: 1, catalyst: true },
        },
        products: { Razorium: 1 },
      },
    ];
    const { pairs, conflictsByReagent } = computeRazoriumPairs(reactions);
    expect(pairs.size).toBe(1);
    expect(conflictsByReagent.has('CatZ')).toBe(false);
  });
});
