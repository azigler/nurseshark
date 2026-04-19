// Entry point for `npm run gen`. Orchestrates source-config loading, YAML
// parsing, resolution, razorium-conflict computation, spritesheet build, and
// writes everything under public/data/.
import { readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpritePack } from './build-spritesheet';
import { resolveContainers } from './resolve-containers';
import { resolveDamage } from './resolve-damage';
import { resolveFluent } from './resolve-fluent';
import { resolvePhysicalItems } from './resolve-physical-items';
import { resolveReactions } from './resolve-reactions';
import { resolveReagents } from './resolve-reagents';
import { resolveSpecies } from './resolve-species';
import { writeJson } from './save';
import { loadSources } from './sources';
import type { OutMeta, OutReagent } from './types';

const here = dirname(fileURLToPath(import.meta.url));
// src/gen/index.ts -> nurseshark root.
const nursesharkRoot = resolve(here, '../..');

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(nursesharkRoot, 'package.json'), 'utf8'),
    ) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main() {
  const configPath = resolve(nursesharkRoot, 'sources.yml');
  const sources = loadSources(configPath, nursesharkRoot);
  const outDir = resolve(nursesharkRoot, 'public/data');

  console.log(`[nurseshark] VS14 source: ${sources.vs14Path}`);
  console.log(
    `[nurseshark] VS14 commit: ${sources.commitSha ? sources.commitSha.slice(0, 12) : '(unknown)'}`,
  );

  // Clean output directory so stale sprites don't linger.
  try {
    rmSync(outDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  console.log('[nurseshark] reading reagents...');
  const { reagents } = resolveReagents(sources.vs14Path);
  console.log(`  - ${reagents.length} reagents`);

  console.log('[nurseshark] reading reactions + razorium pairs...');
  const { reactions, conflictsByReagent, razoriumPairCount } = resolveReactions(
    sources.vs14Path,
  );
  console.log(`  - ${reactions.length} reactions`);
  console.log(`  - ${razoriumPairCount} unique razorium-conflict pairs`);

  // Fold conflictsWith into the reagent records.
  const reagentsWithConflicts: OutReagent[] = reagents.map((r) => ({
    ...r,
    conflictsWith: Array.from(conflictsByReagent.get(r.id) ?? []).sort(),
  }));

  console.log('[nurseshark] reading damage...');
  const { damageTypes } = resolveDamage(
    sources.vs14Path,
    reagentsWithConflicts,
  );
  console.log(`  - ${damageTypes.length} damage types`);
  const treatable = damageTypes.filter((d) => d.treatable).length;
  console.log(
    `  - ${treatable} treatable, ${damageTypes.length - treatable} non-treatable`,
  );

  console.log('[nurseshark] reading species...');
  const species = resolveSpecies(sources.vs14Path);
  console.log(`  - ${species.length} species`);

  console.log('[nurseshark] reading containers...');
  const containers = resolveContainers(sources.vs14Path);
  console.log(`  - ${containers.length} containers`);

  console.log('[nurseshark] reading physical items...');
  const physicalItems = resolvePhysicalItems(sources.vs14Path);
  console.log(`  - ${physicalItems.length} physical items`);

  console.log('[nurseshark] resolving Fluent messages...');
  const fluent = resolveFluent(sources.vs14Path);
  console.log(`  - ${Object.keys(fluent).length} Fluent keys bundled`);

  console.log('[nurseshark] building sprite pack...');
  const sprites = buildSpritePack(
    reagentsWithConflicts,
    containers,
    species,
    sources.vs14Path,
    outDir,
  );
  console.log(
    `  - ${sprites.reagentCount} reagent sprites, ${sprites.containerCount} container sprites, ${sprites.speciesCount} species sprites`,
  );

  // Fold sprite indices back in.
  const reagentsFinal = reagentsWithConflicts.map((r) => ({
    ...r,
    spritesheetIndex: sprites.manifest[`reagent:${r.id}`]?.path ?? null,
  }));
  const containersFinal = containers.map((c) => ({
    ...c,
    spritesheetIndex: sprites.manifest[`container:${c.id}`]?.path ?? null,
  }));

  const meta: OutMeta = {
    ss14CommitSha: sources.commitSha,
    nursesharkVersion: readPackageVersion(),
    builtAt: new Date().toISOString(),
    sourcePath: sources.vs14Path,
  };

  console.log(`[nurseshark] writing JSON -> ${outDir}`);
  writeJson(outDir, 'reagents', reagentsFinal);
  writeJson(outDir, 'reactions', reactions);
  writeJson(outDir, 'damage', damageTypes);
  writeJson(outDir, 'species', species);
  writeJson(outDir, 'containers', containersFinal);
  writeJson(outDir, 'physical-items', physicalItems);
  writeJson(outDir, 'sprites_manifest', sprites.manifest);
  writeJson(outDir, 'fluent', fluent);
  writeJson(outDir, 'meta', meta);
  console.log('[nurseshark] done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
