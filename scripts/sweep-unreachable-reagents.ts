// Sweep script — identifies reagents not produced by any reaction. The
// output is a pipe-separated list (id | group | reason hint) meant as a
// starting point for the hand-curated `src/data/reagent-blacklist.ts`.
//
// Run with: `npx tsx scripts/sweep-unreachable-reagents.ts`
//
// The sweep is intentionally conservative: it flags reagents that are
// provably unreachable via the reaction pipeline (i.e. no recipe outputs
// them). It does NOT try to reason about "reachable-but-from-plants" or
// "reachable-but-from-alien-mobs" etc. — that's for the manual curation
// pass. Reasons taxonomy (assign during curation):
//   - "uncraftable"     — no reaction produces it, admin-spawn or world-seeded
//   - "admin-only"      — admin/debug reagents
//   - "syndicate-only"  — syndicate item reagents (not in a chem dispenser)
//   - "botany-only"     — produced by plants via seed.produce, not by chems
//   - "special-event"   — event-only reagents (e.g. event reward drops)
//   - "other"           — anything else worth flagging

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ReagentLite {
  readonly id: string;
  readonly group: string | null;
}

interface ReactionComponentLite {
  readonly id: string;
  readonly amount: number;
}

interface ReactionLite {
  readonly id: string;
  readonly products: readonly ReactionComponentLite[];
}

function loadJson<T>(rel: string): T {
  const p = resolve(__dirname, '..', 'public', 'data', rel);
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

function main(): void {
  const reagents = loadJson<readonly ReagentLite[]>('reagents.json');
  const reactions = loadJson<readonly ReactionLite[]>('reactions.json');

  // Build the set of reagent IDs that appear as a reaction product.
  const produced = new Set<string>();
  for (const rx of reactions) {
    for (const p of rx.products) {
      produced.add(p.id);
    }
  }

  // Heuristic hints — groups that strongly suggest why a reagent might be
  // unreachable. These are *hints only*; the human reviewer confirms.
  const hintForGroup = (group: string | null): string => {
    if (!group) return 'uncraftable';
    const g = group.toLowerCase();
    if (g === 'biological') return 'uncraftable';
    if (g === 'narcotic') return 'syndicate-only';
    if (g === 'toxin') return 'admin-only';
    if (g === 'special' || g === 'admin') return 'admin-only';
    if (g === 'drink' || g === 'food' || g === 'foods') return 'other';
    return 'uncraftable';
  };

  const unreachable = reagents
    .filter((r) => !produced.has(r.id))
    .map((r) => ({
      id: r.id,
      group: r.group ?? '(no group)',
      reason: hintForGroup(r.group),
    }))
    .sort((a, b) => {
      if (a.reason !== b.reason) return a.reason.localeCompare(b.reason);
      if (a.group !== b.group) return a.group.localeCompare(b.group);
      return a.id.localeCompare(b.id);
    });

  // Output: pipe-separated rows + a small header to stderr for humans.
  process.stderr.write(
    `# Sweep: ${unreachable.length} / ${reagents.length} reagents are unreachable via reactions.\n`,
  );
  process.stderr.write('# Format: id | group | reason-hint\n');
  process.stderr.write(
    '# Hints are heuristic — confirm before adding to the blacklist.\n\n',
  );
  for (const row of unreachable) {
    process.stdout.write(`${row.id} | ${row.group} | ${row.reason}\n`);
  }
}

main();
