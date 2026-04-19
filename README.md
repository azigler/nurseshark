# Nurseshark

Chemistry, medical, and cryo companion for [Space Station 14](https://github.com/space-wizards/space-station-14).

A first-party tool of [Vacation Station 14](https://github.com/azigler/vacation-station-14),
designed for rapid in-game use by chemists and medics. Static site, no backend,
keyboard-first, localStorage-persisted mix-group planner.

**Live:** `https://ss14.zig.computer/nurseshark/` (coming soon)

## Scope

Three sections, structurally mirrored to the SS14 Cookbook so navigation feels
familiar:

- **Medical** — treatment references per damage type (brute, toxin, burn,
  airloss, genetic), each with dosages, healing rates, overdose thresholds,
  and hazard warnings.
- **Chemistry** — full reagent + reaction catalog: inputs, catalysts,
  temperature, outputs. Searchable and filterable.
- **Cryo** — cryo procedures, beaker setup, cryoxadone stacks, emergency
  stabilization.

Plus the UX that makes it useful *while playing*:

- Fuzzy search across all reagents + reactions
- Copy-label: one-click clipboard with a formatted label string per reagent
  or per mix group (includes operator name + date)
- Keyboard-first navigation (`/` to search, `c` to copy, `esc` to close)
- **Mix-group planner** — queue multiple reagents, specify desired volumes,
  get a total ingredient list + optimal reaction order + container plan
  (jugs / beakers / droppers). Persisted to localStorage. Shareable via
  URL fragment so a chemist can DM a teammate a prepared batch.

## Tech

- TypeScript 5
- React 18 + Vite
- Static output (`dist/`) — served by any HTTP server; no backend
- Vitest for tests
- Node 20+

## Development

```bash
npm install
npm run dev            # Vite dev server on http://localhost:5517
npm run build          # static bundle to dist/
npm run preview        # serve the production bundle locally
npm run typecheck
npm test
```

### Data pipeline (planned)

Like the SS14 Cookbook, Nurseshark parses Space Station 14's own YAML
prototype data to extract reagents, reactions, damage effects, and
container specs — keeping the reference correct as game data evolves. The
pipeline lives under `src/gen/` and runs at build time, writing JSON into
`public/data/`.

## License

AGPLv3-or-later. See [`LICENSE`](./LICENSE).

## Inspirations

- [SS14 Cookbook](https://github.com/arimah/ss14-cookbook) — structural
  inspiration for the SS14-YAML-driven static-site pattern. Nurseshark
  mirrors the "understand one, understand the other" navigation feel but
  ships an entirely original codebase.
- [bugmedical](https://hoshizora-sayo.github.io/bugmedical/) — catalyzed
  the idea for a proper chemistry/medical companion tool. Content
  organization (damage-type sections, Pro Tips callouts) takes cues from
  it, but all content is re-generated from game data.
- **Official SS14 wiki (primary canonical reference for language + facts):**
  - [Medical](https://wiki.spacestation14.com/wiki/Medical)
  - [Guide to Medical](https://wiki.spacestation14.com/wiki/Guide_to_Medical)
  - [Reagents](https://wiki.spacestation14.com/wiki/Reagents)
  - [Medicine](https://wiki.spacestation14.com/wiki/Medicine)

  Nurseshark's interpretive descriptions (heal rates, OD thresholds,
  side effects, species-specific notes) follow the wiki's phrasing
  conventions so players moving between the wiki and this tool read the
  same language. We're equal with the base game — not replacing the
  wiki, matching its voice.

Nurseshark's code, content, and data pipeline are all original work under
AGPLv3. Neither repo's code is included.

## Contributing

Development is currently driven from the Vacation Station 14 monorepo via
the bead tracking system (`br`). See [`vs-3il`](https://github.com/azigler/vacation-station-14)
for the epic roadmap.
