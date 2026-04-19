// Builds per-id sprite PNGs under `public/data/sprites/`. This is simpler
// than packing a single atlas and is fine for v1 since the frontend only
// needs ~25 container icons + ~200 solid-color reagent swatches + ~11
// species head portraits.
//
// The manifest maps id -> { path, w, h }. The frontend can just
// `<img src={`/data/${manifest[id].path}`} />`.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type {
  OutContainer,
  OutReagent,
  OutSpecies,
  SpriteManifestEntry,
} from './types';

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

/**
 * Species-id -> the RSI subdirectory + head state file (without .png) to pull
 * a portrait from. Source sprites live at
 * `Resources/Textures/Mobs/Species/<dir>/parts.rsi/<state>.png`.
 *
 * The RSI head sprites are 2x2 directional grids (64x64, 32-per-frame) —
 * south, north, east, west. We crop the top-left 32x32 (south-facing) frame
 * to use as the portrait. A handful of species have only a genderless
 * `head.png`, so no `head_m`/`head_f` split is needed there.
 *
 * Pragmatic simplification: SS14 mob sprites are genuinely composite (body +
 * head + markings + clothes, all tinted at runtime via skinColoration). We
 * ship the raw greyscale head mask untinted — it still reads as distinctive
 * per-species (Vox beak, Moth antennae, Diona leafy head, Gingerbread
 * cookie, etc.). Future work: render a real composite portrait by walking
 * the species prototype's appearance visuals. Tracked as follow-up to
 * vs-3il.1.
 *
 * Dwarf reuses Human sprites (its mob prototype parents MobHuman). Slime's
 * species ID is `SlimePerson` but its texture directory is `Slime/`.
 */
const SPECIES_ICON_MAP: Record<string, { dir: string; state: string }> = {
  Arachnid: { dir: 'Arachnid', state: 'head' },
  Diona: { dir: 'Diona', state: 'head' },
  Dwarf: { dir: 'Human', state: 'head_m' },
  Gingerbread: { dir: 'Gingerbread', state: 'head' },
  Human: { dir: 'Human', state: 'head_m' },
  Moth: { dir: 'Moth', state: 'head' },
  Reptilian: { dir: 'Reptilian', state: 'head_m' },
  Skeleton: { dir: 'Skeleton', state: 'head' },
  SlimePerson: { dir: 'Slime', state: 'head' },
  Vox: { dir: 'Vox', state: 'head' },
  Vulpkanin: { dir: 'Vulpkanin', state: 'head' },
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

/**
 * Crop the top-left SPRITE_SIZE x SPRITE_SIZE frame out of a directional RSI
 * sprite sheet (RSIs lay out directions as a 2x2 grid: south, north, east,
 * west). This is exactly the south-facing portrait, which is what we want
 * for a badge/pill.
 *
 * If the source is already 32x32 (single-direction state), we just copy it.
 */
function writeSpeciesPortraitSprite(srcPath: string, dstPath: string): void {
  const raw = readFileSync(srcPath);
  const src = PNG.sync.read(raw);
  const out = new PNG({ width: SPRITE_SIZE, height: SPRITE_SIZE });
  const cropW = Math.min(SPRITE_SIZE, src.width);
  const cropH = Math.min(SPRITE_SIZE, src.height);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const sIdx = (src.width * y + x) << 2;
      const dIdx = (SPRITE_SIZE * y + x) << 2;
      out.data[dIdx] = src.data[sIdx];
      out.data[dIdx + 1] = src.data[sIdx + 1];
      out.data[dIdx + 2] = src.data[sIdx + 2];
      out.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
  const buf = PNG.sync.write(out);
  writeFileSync(dstPath, buf);
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
  readonly speciesCount: number;
}

export function buildSpritePack(
  reagents: readonly OutReagent[],
  containers: readonly OutContainer[],
  species: readonly OutSpecies[],
  vs14Path: string,
  outputDir: string,
): SpriteBuildResult {
  const reagentDir = join(outputDir, 'sprites/reagents');
  const containerDir = join(outputDir, 'sprites/containers');
  const speciesDir = join(outputDir, 'sprites/species');
  mkdirSync(reagentDir, { recursive: true });
  mkdirSync(containerDir, { recursive: true });
  mkdirSync(speciesDir, { recursive: true });

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

  // Species: crop the south-facing head portrait out of the parts.rsi sheet.
  // See SPECIES_ICON_MAP header comment for the pragmatic-simplification
  // rationale (raw greyscale mask, no runtime tint/composite).
  for (const s of species) {
    const mapping = SPECIES_ICON_MAP[s.id];
    if (!mapping) {
      console.warn(`WARN: no species icon mapping for ${s.id}`);
      continue;
    }
    const srcPath = join(
      vs14Path,
      'Resources/Textures/Mobs/Species',
      mapping.dir,
      'parts.rsi',
      `${mapping.state}.png`,
    );
    if (!existsSync(srcPath)) {
      console.warn(`WARN: species icon missing for ${s.id}: ${srcPath}`);
      continue;
    }
    const dstName = `${s.id}.png`;
    try {
      writeSpeciesPortraitSprite(srcPath, join(speciesDir, dstName));
      manifest[`species:${s.id}`] = {
        path: `sprites/species/${dstName}`,
        w: SPRITE_SIZE,
        h: SPRITE_SIZE,
      };
    } catch (e) {
      console.warn(
        `WARN: failed to crop species icon for ${s.id}: ${(e as Error).message}`,
      );
    }
  }

  return {
    manifest,
    reagentCount: reagents.length,
    containerCount: Object.keys(manifest).filter((k) =>
      k.startsWith('container:'),
    ).length,
    speciesCount: Object.keys(manifest).filter((k) => k.startsWith('species:'))
      .length,
  };
}
