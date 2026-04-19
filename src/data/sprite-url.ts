// Resolves a reagent/container ID to the URL that should go into an <img src>.
// The sprites live in public/data/sprites/... — Vite copies public/ wholesale
// into dist/, so we just need the BASE_URL prefix.

import type { SpriteManifest } from '../types';

function base(): string {
  return (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/');
}

export function reagentSpriteUrl(
  manifest: SpriteManifest,
  reagentId: string,
): string | null {
  const entry = manifest[`reagent:${reagentId}`];
  if (!entry) {
    return null;
  }
  return `${base()}data/${entry.path}`;
}

export function containerSpriteUrl(
  manifest: SpriteManifest,
  containerId: string,
): string | null {
  const entry = manifest[`container:${containerId}`];
  if (!entry) {
    return null;
  }
  return `${base()}data/${entry.path}`;
}

export function speciesSpriteUrl(
  manifest: SpriteManifest,
  speciesId: string,
): string | null {
  const entry = manifest[`species:${speciesId}`];
  if (!entry) {
    return null;
  }
  return `${base()}data/${entry.path}`;
}
