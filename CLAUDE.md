# Nurseshark

VS14-native chemistry/medical/cryo companion web app. See `vs-3il` in the
vacation-station-14 bead tree for full epic spec and open questions.

## Tech stack

- TypeScript 5 + React 18 + Vite
- Static output (`dist/`), no backend
- Data pipeline parses SS14 YAML at build time (`src/gen/`, planned)
- Node 20+ / npm
- AGPLv3-or-later license

## Conventions

- Strict TypeScript, explicit types on public APIs
- Functional React components, no classes
- Hooks for state (including `useLocalStorage` wrappers for mix-group
  persistence)
- CSS modules or co-located `*.css` siblings, not styled-components
- Tests via Vitest, colocated in `*.test.ts(x)` siblings

## Harness (local dev scaffolding)

This repo uses Vacation Station 14's Claude Code harness via gitignored
symlinks:

- `.claude/` → `/home/ubuntu/vacation-station-14/.claude/`
- `hooks/` → `/home/ubuntu/vacation-station-14/hooks/`
- `.beads/` → `/home/ubuntu/vacation-station-14/.beads/`

The symlinks are local-only (gitignored). Coworkers cloning Nurseshark
get a pure TS+React project without the VS14 harness. If you clone on a
host where VS14 is also present, re-create the symlinks:

```bash
ln -s /path/to/vacation-station-14/.claude .claude
ln -s /path/to/vacation-station-14/hooks hooks
ln -s /path/to/vacation-station-14/.beads .beads
```

Task tracking: beads IDs are shared with VS14 (they point at the same
`issues.jsonl`). Nurseshark work lands under `vs-3il.*` children.

Skills + hooks share too — `/commit`, `/beads`, `/lint`, `/branch`, etc.
all work here the same way they do in VS14.

## Development loop

```bash
npm install
npm run dev            # http://localhost:5517
npm run build
npm run typecheck
npm test
```

## Blacklist maintenance

`src/data/reagent-blacklist.ts` is a hand-curated list of reagents that are
NOT reachable via chemistry (admin-spawn / world-seed / botany-derived /
event-only). The solver skips them by default so it won't recommend mixes
a chemist can't actually make (e.g. the original Rororium bug). The
reagent browser hides them behind a "Show admin / rare reagents" toggle.

To regenerate the candidate list after a VS14 data refresh:

```bash
npx tsx scripts/sweep-unreachable-reagents.ts > /tmp/sweep.txt
```

The sweep prints `id | group | reason-hint` lines for every reagent with
no reaction producing it. Compare against the current blacklist and
hand-curate:

- **Always add** any new unreachable reagent with `heals[]` entries — the
  solver would otherwise pick it.
- **Usually add** new Medicine / Biological group entries without heals
  that a medic might wrongly reach for.
- **Don't add** basic Elements (Iron, Aluminium, etc.) — those are
  dispenser primitives.
- **Don't add** craftable-but-dangerous chems (Razorium, Meth, Lexorin,
  Nocturine, Hyperzine, Heartbreaker). They're valid outputs in niche
  scenarios; the UI differentiates via reason tags elsewhere.

Taxonomy for the `reason` field:

| Reason            | Use for                                                 |
|-------------------|---------------------------------------------------------|
| `uncraftable`     | No reaction produces it; admin-spawn or world-seed only |
| `admin-only`      | Debug / ghost-role / observer-tool reagents             |
| `syndicate-only`  | Syndicate synthesis kits, not chem dispenser            |
| `botany-only`     | Produced by plants via seed.produce                     |
| `special-event`   | Event reward / artifact / xenoarch drops                |
| `other`           | Anything else worth flagging                            |

After curating, run `npm test` — the solver tests in
`src/data/__tests__/solver.test.ts` include assertions that the default
solver never picks Rororium / Omnizine for their "best-match" damage
types. Update those tests if you add a new heal-carrying blacklist entry
that would unseat an existing expected pick.

## License

AGPLv3-or-later, matching VS14 first-party code.

## Inspirations (not dependencies)

- [SS14 Cookbook](https://github.com/arimah/ss14-cookbook) — we borrow
  structural ideas (YAML data pipeline, static output, per-reagent cards)
  but share no code.
- [bugmedical](https://hoshizora-sayo.github.io/bugmedical/) — content
  organization cue; all content is re-generated from game data.
- **Official SS14 wiki** — canonical language reference for our
  interpretive text. Mirror the wiki's phrasing so a player reading
  [Medical](https://wiki.spacestation14.com/wiki/Medical),
  [Guide to Medical](https://wiki.spacestation14.com/wiki/Guide_to_Medical),
  [Reagents](https://wiki.spacestation14.com/wiki/Reagents), or
  [Medicine](https://wiki.spacestation14.com/wiki/Medicine) sees the
  same voice here. Equal with base game, not replacing it.
