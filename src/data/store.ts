// Single data store for the SPA. Loads all of `public/data/*.json` once at
// startup and exposes typed accessors + derived indices (e.g. "reactions
// that produce reagent X"). Components read via the `useData()` hook.

import { createContext, useContext } from 'react';
import type {
  Container,
  DamageType,
  FluentDict,
  Meta,
  PhysicalItem,
  Reaction,
  Reagent,
  Species,
  SpriteManifest,
} from '../types';

export interface DataBundle {
  readonly reagents: readonly Reagent[];
  readonly reactions: readonly Reaction[];
  readonly damage: readonly DamageType[];
  readonly species: readonly Species[];
  readonly containers: readonly Container[];
  readonly physicalItems: readonly PhysicalItem[];
  readonly fluent: FluentDict;
  readonly meta: Meta;
  readonly sprites: SpriteManifest;
  // Derived indices.
  readonly reagentsById: ReadonlyMap<string, Reagent>;
  readonly reactionsById: ReadonlyMap<string, Reaction>;
  readonly damageById: ReadonlyMap<string, DamageType>;
  readonly speciesById: ReadonlyMap<string, Species>;
  readonly containersById: ReadonlyMap<string, Container>;
  readonly physicalItemsById: ReadonlyMap<string, PhysicalItem>;
  /** damage group id -> member type ids. */
  readonly damageGroupMembers: ReadonlyMap<string, readonly string[]>;
  /** reagent id -> reactions where it appears in products. */
  readonly reactionsProducing: ReadonlyMap<string, readonly Reaction[]>;
  /** reagent id -> reactions where it appears as a reactant or catalyst. */
  readonly reactionsConsuming: ReadonlyMap<string, readonly Reaction[]>;
}

export interface LoadState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: string | null;
  readonly data: DataBundle | null;
}

function base(): string {
  // Vite injects this from the `base` config. In dev it's "/", in prod
  // "/nurseshark/". Either way it ends with a slash.
  return (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/');
}

async function fetchJson<T>(relPath: string): Promise<T> {
  const url = `${base()}data/${relPath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function loadDataBundle(): Promise<DataBundle> {
  const [
    reagents,
    reactions,
    damage,
    species,
    containers,
    physicalItems,
    fluent,
    meta,
    sprites,
  ] = await Promise.all([
    fetchJson<readonly Reagent[]>('reagents.json'),
    fetchJson<readonly Reaction[]>('reactions.json'),
    fetchJson<readonly DamageType[]>('damage.json'),
    fetchJson<readonly Species[]>('species.json'),
    fetchJson<readonly Container[]>('containers.json'),
    fetchJson<readonly PhysicalItem[]>('physical-items.json'),
    fetchJson<FluentDict>('fluent.json'),
    fetchJson<Meta>('meta.json'),
    fetchJson<SpriteManifest>('sprites_manifest.json'),
  ]);

  const reagentsById = new Map(reagents.map((r) => [r.id, r]));
  const reactionsById = new Map(reactions.map((r) => [r.id, r]));
  const damageById = new Map(damage.map((d) => [d.id, d]));
  const speciesById = new Map(species.map((s) => [s.id, s]));
  const containersById = new Map(containers.map((c) => [c.id, c]));
  const physicalItemsById = new Map(physicalItems.map((p) => [p.id, p]));

  // Damage group membership: derived from damage.group on each type.
  const damageGroupMembers = new Map<string, string[]>();
  for (const d of damage) {
    if (d.group) {
      const arr = damageGroupMembers.get(d.group) ?? [];
      arr.push(d.id);
      damageGroupMembers.set(d.group, arr);
    }
  }

  // Reaction indices.
  const reactionsProducing = new Map<string, Reaction[]>();
  const reactionsConsuming = new Map<string, Reaction[]>();
  for (const rx of reactions) {
    for (const p of rx.products) {
      const arr = reactionsProducing.get(p.id) ?? [];
      arr.push(rx);
      reactionsProducing.set(p.id, arr);
    }
    for (const c of [...rx.reactants, ...rx.catalysts]) {
      const arr = reactionsConsuming.get(c.id) ?? [];
      arr.push(rx);
      reactionsConsuming.set(c.id, arr);
    }
  }

  return {
    reagents,
    reactions,
    damage,
    species,
    containers,
    physicalItems,
    fluent,
    meta,
    sprites,
    reagentsById,
    reactionsById,
    damageById,
    speciesById,
    containersById,
    physicalItemsById,
    damageGroupMembers,
    reactionsProducing,
    reactionsConsuming,
  };
}

export const DataContext = createContext<LoadState>({
  status: 'loading',
  error: null,
  data: null,
});

export function useLoadState(): LoadState {
  return useContext(DataContext);
}

export function useData(): DataBundle {
  const state = useContext(DataContext);
  if (!state.data) {
    throw new Error('useData() called before data bundle loaded');
  }
  return state.data;
}
