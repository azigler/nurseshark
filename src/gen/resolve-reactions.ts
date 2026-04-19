// Walks Recipes/Reactions/ and builds reactions.json, simultaneously
// discovering razorium-conflict pairs (reactions whose products include
// Razorium — their reactants get recorded as mutual `conflictsWith`).
import { join } from 'node:path';
import { findYamlFiles, readPrototypes } from './read-yaml';
import type {
  OutReaction,
  OutReactionComponent,
  RawReactionPrototype,
} from './types';

const RAZORIUM_ID = 'Razorium';

export interface ResolveReactionsResult {
  readonly reactions: readonly OutReaction[];
  /** reagent ID -> set of reagent IDs that co-form Razorium with it. */
  readonly conflictsByReagent: ReadonlyMap<string, ReadonlySet<string>>;
  readonly razoriumPairCount: number;
}

export function resolveReactions(vs14Path: string): ResolveReactionsResult {
  const reactionDir = join(vs14Path, 'Resources/Prototypes/Recipes/Reactions');
  const files = findYamlFiles(reactionDir);
  const raw = readPrototypes(files, [
    'reaction',
  ]) as unknown as RawReactionPrototype[];

  const reactions: OutReaction[] = [];
  // Use a Set-of-pairs to count unique pairs (not per-reaction).
  const uniquePairs = new Set<string>();
  const conflictsByReagent = new Map<string, Set<string>>();

  for (const r of raw) {
    if (!r.id) continue;

    const reactants: OutReactionComponent[] = [];
    const catalysts: OutReactionComponent[] = [];
    for (const [id, obj] of Object.entries(r.reactants ?? {})) {
      const amount = typeof obj?.amount === 'number' ? obj.amount : 1;
      const rec: OutReactionComponent = { id, amount };
      if (obj?.catalyst) {
        catalysts.push(rec);
      } else {
        reactants.push(rec);
      }
    }

    const products: OutReactionComponent[] = [];
    for (const [id, amt] of Object.entries(r.products ?? {})) {
      if (typeof amt === 'number') {
        products.push({ id, amount: amt });
      }
    }

    const producesRazorium = products.some((p) => p.id === RAZORIUM_ID);
    const conflictPair: string[] = [];
    if (producesRazorium) {
      // Every pair of distinct (non-catalyst) reactants in this reaction
      // is a razorium-triggering combination.
      const ids = reactants.map((x) => x.id);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i];
          const b = ids[j];
          const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
          if (!uniquePairs.has(pair)) {
            uniquePairs.add(pair);
            conflictPair.push(a, b);
          }
          let setA = conflictsByReagent.get(a);
          if (!setA) {
            setA = new Set();
            conflictsByReagent.set(a, setA);
          }
          let setB = conflictsByReagent.get(b);
          if (!setB) {
            setB = new Set();
            conflictsByReagent.set(b, setB);
          }
          setA.add(b);
          setB.add(a);
        }
      }
    }

    reactions.push({
      id: r.id,
      reactants,
      catalysts,
      products,
      minTemp: typeof r.minTemp === 'number' ? r.minTemp : null,
      maxTemp: typeof r.maxTemp === 'number' ? r.maxTemp : null,
      impact: r.impact ?? null,
      conflictsWith: producesRazorium
        ? conflictPair.filter((x) => x !== RAZORIUM_ID)
        : [],
    });
  }

  reactions.sort((a, b) => a.id.localeCompare(b.id));
  return { reactions, conflictsByReagent, razoriumPairCount: uniquePairs.size };
}
