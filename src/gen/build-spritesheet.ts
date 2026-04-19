// Builds per-id sprite PNGs under `public/data/sprites/`. This is simpler
// than packing a single atlas and is fine for v1 since the frontend only
// needs ~25 container icons + ~200 solid-color reagent swatches.
//
// The manifest maps id -> { path, w, h }. The frontend can just
// `<img src={`/data/${manifest[id].path}`} />`.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { OutContainer, OutReagent, SpriteManifestEntry } from './types';

const SPRITE_SIZE = 32;

/**
 * Container-id -> RSI-relative path (without .png) that best represents its
 * empty-state icon. When no entry here, we fall back to a small default.
 */
const CONTAINER_ICON_MAP: Record<string, { rsi: string; state: string }> = {
  Jug: { rsi: 'Objects/Specific/Chemistry/jug.rsi', state: 'icon_empty' },
  Beaker: { rsi: 'Objects/Specific/Chemistry/beaker.rsi', state: 'beaker' },
  BaseBeaker: { rsi: 'Objects/Specific/Chemistry/beaker.rsi', state: 'beaker' },
  LargeBeaker: {
    rsi: 'Objects/Specific/Chemistry/beaker_large.rsi',
    state: 'beakerlarge',
  },
  CryostasisBeaker: {
    rsi: 'Objects/Specific/Chemistry/beaker_cryostasis.rsi',
    state: 'beakernoreact',
  },
  BluespaceBeaker: {
    rsi: 'Objects/Specific/Chemistry/beaker_bluespace.rsi',
    state: 'beakerbluespace',
  },
  Dropper: { rsi: 'Objects/Specific/Chemistry/dropper.rsi', state: 'dropper' },
  Syringe: {
    rsi: 'Objects/Specific/Chemistry/syringe.rsi',
    state: 'syringe_base0',
  },
  SyringeBase: {
    rsi: 'Objects/Specific/Chemistry/syringe.rsi',
    state: 'syringe_base0',
  },
  Vial: { rsi: 'Objects/Specific/Chemistry/vial.rsi', state: 'vial' },
  MiniVial: {
    rsi: 'Objects/Specific/Chemistry/vial_mini.rsi',
    state: 'mini_vial',
  },
  Bottle: { rsi: 'Objects/Specific/Chemistry/bottle.rsi', state: 'bottle-1' },
  ChemBag: {
    rsi: 'Objects/Specific/Chemistry/chem_bag.rsi',
    state: 'icon',
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '');
  if (h.length === 3) {
    return [
      Number.parseInt(h[0] + h[0], 16),
      Number.parseInt(h[1] + h[1], 16),
      Number.parseInt(h[2] + h[2], 16),
    ];
  }
  const expanded = h.padEnd(6, '0').slice(0, 6);
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function writeSolidColorSprite(path: string, color: string): void {
  const [r, g, b] = hexToRgb(color);
  const png = new PNG({ width: SPRITE_SIZE, height: SPRITE_SIZE });
  for (let y = 0; y < SPRITE_SIZE; y++) {
    for (let x = 0; x < SPRITE_SIZE; x++) {
      // Draw a small rounded look by leaving 2px transparent border.
      const border =
        x < 2 || y < 2 || x >= SPRITE_SIZE - 2 || y >= SPRITE_SIZE - 2;
      const idx = (SPRITE_SIZE * y + x) << 2;
      if (border) {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
      } else {
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = 255;
      }
    }
  }
  const buf = PNG.sync.write(png);
  writeFileSync(path, buf);
}

export interface SpriteBuildResult {
  readonly manifest: Record<string, SpriteManifestEntry>;
  readonly reagentCount: number;
  readonly containerCount: number;
}

export function buildSpritePack(
  reagents: readonly OutReagent[],
  containers: readonly OutContainer[],
  vs14Path: string,
  outputDir: string,
): SpriteBuildResult {
  const reagentDir = join(outputDir, 'sprites/reagents');
  const containerDir = join(outputDir, 'sprites/containers');
  mkdirSync(reagentDir, { recursive: true });
  mkdirSync(containerDir, { recursive: true });

  const manifest: Record<string, SpriteManifestEntry> = {};

  // Reagents: render a solid-color 32x32 swatch tinted with the reagent color.
  for (const r of reagents) {
    const color = r.color ?? '#888888';
    const fileName = `${r.id}.png`;
    writeSolidColorSprite(join(reagentDir, fileName), color);
    manifest[`reagent:${r.id}`] = {
      path: `sprites/reagents/${fileName}`,
      w: SPRITE_SIZE,
      h: SPRITE_SIZE,
    };
  }

  // Containers: copy the first-frame empty-icon PNG from the RSI.
  for (const c of containers) {
    const mapping = CONTAINER_ICON_MAP[c.id];
    if (!mapping) continue;
    const srcPath = join(
      vs14Path,
      'Resources/Textures',
      mapping.rsi,
      `${mapping.state}.png`,
    );
    if (!existsSync(srcPath)) {
      console.warn(`WARN: container icon missing for ${c.id}: ${srcPath}`);
      continue;
    }
    const dstName = `${c.id}.png`;
    try {
      copyFileSync(srcPath, join(containerDir, dstName));
      manifest[`container:${c.id}`] = {
        path: `sprites/containers/${dstName}`,
        w: SPRITE_SIZE,
        h: SPRITE_SIZE,
      };
    } catch (e) {
      console.warn(
        `WARN: failed to copy container icon for ${c.id}: ${(e as Error).message}`,
      );
    }
  }

  return {
    manifest,
    reagentCount: reagents.length,
    containerCount: Object.keys(manifest).filter((k) =>
      k.startsWith('container:'),
    ).length,
  };
}
