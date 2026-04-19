// Unit tests for the sprite-url resolver. Covers the three manifest key
// shapes the pipeline emits (reagent: / container: / species:) and the
// "missing entry" fallback path.

import { describe, expect, it } from 'vitest';
import type { SpriteManifest } from '../../types';
import {
  containerSpriteUrl,
  reagentSpriteUrl,
  speciesSpriteUrl,
} from '../sprite-url';

const manifest: SpriteManifest = {
  'reagent:Bicaridine': {
    path: 'sprites/reagents/Bicaridine.png',
    w: 32,
    h: 32,
  },
  'container:Jug': { path: 'sprites/containers/Jug.png', w: 32, h: 32 },
  'species:Vox': { path: 'sprites/species/Vox.png', w: 32, h: 32 },
  'species:Moth': { path: 'sprites/species/Moth.png', w: 32, h: 32 },
};

describe('speciesSpriteUrl', () => {
  it('resolves a known species id to a /data/ URL', () => {
    const url = speciesSpriteUrl(manifest, 'Vox');
    expect(url).toBe('/data/sprites/species/Vox.png');
  });

  it('returns null for an unmapped species so callers can use the dot fallback', () => {
    expect(speciesSpriteUrl(manifest, 'Xenomorph')).toBeNull();
  });

  it('does not leak reagent/container entries into species lookups', () => {
    // "Jug" happens to be a container key — ensure we do NOT return it when
    // asked for the species "Jug".
    expect(speciesSpriteUrl(manifest, 'Jug')).toBeNull();
  });
});

describe('reagentSpriteUrl + containerSpriteUrl (regression)', () => {
  it('still resolves reagent and container keys', () => {
    expect(reagentSpriteUrl(manifest, 'Bicaridine')).toBe(
      '/data/sprites/reagents/Bicaridine.png',
    );
    expect(containerSpriteUrl(manifest, 'Jug')).toBe(
      '/data/sprites/containers/Jug.png',
    );
  });
});
