---
title: Nurseshark Pro Tips
source_of_truth: hand-curated
last_reviewed: 2026-04-18
ss14_version_checked_against: vs14 flavor-A post-reset (commit 86a6f6a3)
---

# Nurseshark Pro Tips

Tribal knowledge for chemists and medics. Grouped by theme. Each tip is
tagged `[verified]` (checked against current game YAML), `[unverified]`
(conventional wisdom, not yet checked), `[new]` (original insight
surfaced during research), or `[verified-wiki]` (cited directly from the
SS14 wiki — see Sources at the bottom).

When we ship, the app renders this file as a callouts layer across the
Medical / Chemistry / Cryo sections — tips show up next to the reagent
or procedure they reference.

---

## Triage and revival

- **[verified-wiki] Critical patients constantly take asphyxiation damage.**
  Patients in the [Critical] state will constantly take Asphyxiation Damage,
  so ideally you should treat them quickly, or give them chemicals like
  Epinephrine or Inaprovaline to prevent them from dying.
- **[verified-wiki] Revival flow: damage < 200, then defib, then chems.**
  To revive a dead patient, total damage must be below 200. Use topicals
  (brute packs, ointments, gauze) to reduce damage, then defibrillate.
  This brings them to critical; use chemicals for the rest.
- **[verified-wiki] Tricordrazine only works below 50 total damage.** Heals
  1 brute + 0.5 poison + 1 burn per unit. Good as a fallback when better
  meds aren't available, and a solid medibot loadout for minor injuries.
- **[verified-wiki] Epinephrine quirk — critical-state only.** Technically
  heals Brute/Burn/Poison, but ONLY when the patient is in the critical
  state. For non-crit patients, use direct meds instead.
- **[verified-wiki] Dermaline OD top-up trick.** Max safe dose is 10u,
  syringe holds 15u. Fill the last 5u with Tricordrazine for piggyback
  healing without crossing the OD threshold.

## Stasis bed

- **[verified-wiki] Slows metabolism 10×.** Dead patients on a stasis
  bed are preserved for up to 100 minutes before they rot. A rotting
  patient cannot be revived.
- **[verified-wiki] Side effect: asphyxiates living and critical patients.**
  Stasis beds suppress breathing too — remove the patient as soon as
  they're revived, or you'll kill them a second time.
- **[verified-wiki] Topicals still work on stasis.** Ointments, gauze,
  brute packs, blood bags, medicated sutures, and regenerative meshes
  work fine on stasis since they don't rely on metabolism. Use the
  preservation window to patch wounds without burning chem supplies.

## Bleeding and blood loss

- **[verified-wiki] Everyone has 300u of blood baseline.** Below 90%
  blood level, bloodloss damage begins. Watch the blood pool on the
  tile as a rough visual indicator.
- **[verified-wiki] Three-step bleeding protocol.** (1) Stop the bleeding
  with gauze or Tranexamic Acid. (2) Restore blood level with Iron or
  Saline — or Copper for Arachnids (see below). (3) Cure the bloodloss
  damage with Dexalin Plus.
- **[verified-wiki] Tranexamic Acid is 3× stronger than Pulped Banana Peel**
  and 6× stronger than Inaprovaline for bleed reduction. Reach for it
  when gauze alone isn't keeping up.
- **[verified-wiki] Medipens contain 15u total: Epinephrine + 3u Tranexamic Acid.**
  Everyone starts with one in their survival box. Combat-ready triage
  in one click.
- **[verified-wiki] Arachnid + Iron = TOXIC.** Use Copper for Arachnid
  blood level restoration — iron-chain reagents (Iron, Ferrosoplus)
  poison them. The solver knows about this substitution automatically.

## Defibrillator

- **[verified-wiki] Heals up to 40 asphyxiation, inflicts 5 shock damage.**
  Requires patient total damage below 200. Press **Z** to activate the
  defib after placing it on the patient. Pair with topicals first to
  drop damage under the threshold.

## Medibots

- **[verified-wiki] Default loadout: Tricordrazine (minor) or Inaprovaline (critical).**
  Wrench-anchor medibots near medical beds so they can autonomously
  triage incoming patients without wandering off.

## Chemical delivery methods

- **[verified-wiki] Pills hold up to 20u, slower onset.** Digestion delay
  before absorption — best for prophylactic or long-acting chems.
- **[verified-wiki] Syringes hold up to 15u, near-instant.** The default
  delivery method when you need something working RIGHT NOW.
- **[verified-wiki] CMO hypospray: 30u capacity, 5u doses, instant.**
  Reserved for the Chief Medical Officer — fast repeat dosing without
  reloading between patients.

---

## Brute-med discipline

- **[verified] Never mix two brute meds.** Bicaridine + Bruizine, Bicaridine
  + Lacerinol, Bicaridine + Puncturase, Bruizine + Lacerinol, Bruizine +
  Puncturase — every pair collapses into **Razorium** (toxin group,
  1u per pair). The YAML comment on the reactions literally says
  "This is intended." Keep brute meds in separate containers; never
  batch into one jug.
- **[verified] Bruizine recipe is 1 : 0.9 : 1** (bicaridine : lithium : sugar
  → 2 bruizine). Common guides say "25/25/25 even" — true-ish, but
  25u bicaridine only reacts with 22.5u lithium, leaving 2.5u of
  lithium behind. Bugmedical's "remove lithium after" advice is correct.
  Or just mix 25/22.5/25 and spare yourself the chemmaster step.

## Species-specific medicine (the alien-science layer)

This is where most quick-guides fall short. SS14's species have
divergent biology that changes what's actually safe to give them.

### Vox (nitrogen breathers)
- **[verified] Saline, not iron-chains, for blood loss.** Vox blood
  doesn't metabolize iron (guidebook: "insect/non-standard blood").
  Dexalin Plus and ferrosoplus won't restore blood volume — give
  **Saline** (4 water + 1 table salt → 5 saline).
- **[verified] Vox slow-heal poison under 20 damage.** They can endure
  30s of station air and self-recover over ~2 minutes. **Do not
  aggressively dylovene a Vox** with <20 poison — you risk pushing
  them to dylovene OD (20u) unnecessarily. Watch them heal passively
  first; dylovene only if damage is climbing.
- **[new] Cryo pod gas mix needs swapping for Vox patients.** Standard
  cryo atmo is 79/21 N2/O2 — that's **toxic to Vox**. Before loading
  a Vox into cryo, reset the freezer's gas filter to pure nitrogen
  or pull the O2 canister.
- **[verified] Vox eat weird things.** Welding fuel, raw meat, banana
  peels, eggshells — all safe for Vox digestion. Useful for triage
  when the cafeteria's cleared out.

### Moth people
- **[verified] Insect blood — iron replenishment FAILS.** Same as Vox:
  Saline or bust. Iron pills / ferrosoplus do nothing for a bleeding
  moth.
- **[verified] Moths burn fast.** 30% more heat damage + catch fire
  more easily. A moth in a plasma fire dies twice as quickly as a
  human; front-load dermaline / pyrazine and don't wait to see if
  it gets worse.
- **[verified] Moths tank cold.** 30% LESS cold damage. Don't waste
  leporazine on a moth unless they're deep in cryo crit — they handle
  the freezer better than most species.

### Diona (plant people)
- **[verified] Blood is tree sap — same iron-metabolism exception.**
  Saline works, ferrosoplus doesn't.
- **[new] Robust Harvest HEALS Diona.** Not a mistake — the botany
  fertilizer from hydroponics is a functional medicine for Diona
  patients. Botany can be your pharmacy.
- **[new] Weed killer POISONS Diona.** Inverse: never use anti-weed
  sprays near a Diona patient. They act as contact toxins.
- **[verified] Diona take 50% MORE heat damage + catch fire on any heat
  source.** Same aggressive burn-treatment rule as moths; plus they
  **ignite passively** from electrical shock if shock damage is high
  enough. Keep them away from live cabling.
- **[new] Diona death isn't always permanent.** After death a Diona can
  voluntarily split into three nymphs; the brain-nymph retains the
  player. If you can't revive a Diona body, check nearby tiles for
  nymphs before declaring perma-death. They reform into a new Diona
  after ~10 minutes.

### Slime people
- **[unverified] Nitrous oxide cryo atmosphere.** Bugmedical claims
  slime patients benefit from N2O in the cryo gas filter instead of
  standard. I have NOT verified this against game data; treat as
  folk-wisdom until the data pipeline can confirm/refute against
  slime species biology.

### Reptilian (lizards) / Vulpkanin
- **[unverified] Cold-blooded — leporazine priority.** Reptilians run
  cold when critical; preemptive leporazine before cryo is often cited.
  Vulpkanin biology is closer to human — standard protocols apply
  as far as I can tell. Needs verification pass.

## Cryo workflow

- **[verified] Cryo works better on multi-type damage.** A patient with
  30 brute + 30 burn + 30 oxy loses damage in cryo much faster than
  90 of any single type. The healing effect is per-type.
- **[unverified] "Bring to 170-180 damage before defib" threshold.**
  Conventional medic-chat wisdom. The actual crit/dead threshold
  depends on Station-standard mob max-health which I haven't pinned
  down. Treat as rough guidance, not gospel.
- **[verified] Cryoxadone requires ≤213K internal body temp to work.**
  Standard cryo target. Cryo cells are set to 100K freezer but patient
  temp takes a bit to drop — watch the body-temp readout before
  panicking about "cryo not working."
- **[verified] Opporozidone target is 150K.** Lower than cryoxadone,
  and opporozidone itself requires a hot-plate cook (plasma consumed,
  not catalyst). It's what you use on rotting corpses.
- **[unverified] Opporozidone "195+ cellular = permadead" claim.**
  Folk wisdom; specific number not verified. True that there's a
  cellular-damage ceiling past which revival fails, but the exact
  threshold needs a data-pipeline check.
- **[verified] Pyrazine requires serious heat — minTemp 540K.** Hotplate
  it hard. If the recipe "won't start," your beaker's not hot enough.

## Container + label discipline

- **[new] Label every single beaker.** SS14's "just use the labeler" wisdom
  becomes life-or-death when brute meds are in play. A mislabeled
  bicaridine beaker dumped into a bruizine patient = razorium, and
  razorium is a toxin. Treat the labeler as a required PPE item.
- **[new] Label format convention (Nurseshark suggests):**
  ```
  <reagent> / <units> / <operator initials> <HH:MM>
  ```
  Example: `Bicar / 30u / AZ 14:22`. Short enough to hand-type, long
  enough to triage later. The app's copy-label button uses this
  format by default.
- **[new] Group labels for batch prep.** When prepping a full loadout
  (bicar + dylo + tricord) into matched jugs, use a group prefix
  like `LOADOUT-1 / Bicar / 100u / AZ 14:22`. The mix-group planner
  auto-generates these on batch-copy.
- **[verified] Fersilicite (not "Fersilicate") is the correct spelling.**
  Bugmedical typos it — the reagent ID in YAML is `Fersilicite`.
  Matters if you're copying recipes into a private reference.

## Preemptive medicine

- **[unverified] Cryoxadone before spacewalking.** Commonly cited —
  cryoxadone is metabolized even outside cryo chambers and provides
  heat/cold buffer. The exact heal rate outside cryo context is
  worth verifying against reagent metabolism data.
- **[verified] Epinephrine revives from deep crit.** If a patient is
  at -50 HP or deeper but within revival window, epinephrine (or
  inaprovaline) buys time for defibrillation. Medical bed plus epi
  stabilizer is the standard stop-gap.
- **[new] Saline is universal.** Of all the common medicines, saline
  is the only blood-volume restorer that works on every species
  without exception. Keep a saline jug on the medical rack even if
  the crew is all-human today — you never know when a Moth / Vox /
  Diona rolls in bleeding.

## Workflow + batching

- **[verified] Plasma-as-catalyst in Leporazine (reusable).** The YAML
  confirms `catalyst: true`. One plasma sheet lets you mix infinite
  leporazine batches. Don't waste plasma as an ingredient on it.
- **[verified] Plasma-as-ingredient in Opporozidone (consumed).** Unlike
  leporazine, opporozidone consumes plasma. Budget accordingly if
  you're prepping cryo chems for a major rescue.
- **[new] Mix-group order matters even when the app suggests one.**
  Temperature-sensitive reactions (pyrazine, insuzine, opporozidone)
  should be prepared LAST in a batch so the hotplate is ready and
  no cold ingredient accidentally quenches them. The planner's
  auto-ordering should surface this.

## Zombies

- **[verified] Ambuzol cures a bite (10u, early).** Must be given before
  turning. Ambuzol Plus grants permanent immunity.
- **[verified-wiki] Ambuzol recipe: dylovene + ammonia + zombie blood.**
  Ambuzol+ is Ambuzol + Omnizine and grants permanent immunity. A bite
  received while the patient is already in the critical state causes
  instant zombification — dose Ambuzol BEFORE they go down.
- **[unverified] Omnizine source post-Flavor-A.** Bugmedical says
  omnizine is "from botany or other source, not craftable" — need
  to confirm whether omnizine is still un-synthesizable in the pure
  SS14 base we rebuilt on. If botany can still produce it (via
  specific flower), the ambuzol-plus chain is intact. If not, we
  may need a different end-game immunity path.

## Flags for the data-pipeline (auto-verify candidates)

When the `src/gen/` pipeline is built, these claims are mechanically
checkable and should auto-populate `[verified]` tags rather than
`[unverified]`:

- Every recipe's exact ratios + temperature requirements
- OD thresholds per reagent
- Per-species damage-modifier multipliers (the 30% / 50% figures)
- Catalyst-vs-consumed for every reaction
- Metabolism rates (heal-per-second, per-reagent)
- Chem groups that cross-react into toxins (razorium-style)

The pipeline should lint pro-tips.md against game data and emit
warnings when a `[verified]` tag no longer matches the YAML.

---

## Sources

All `[verified-wiki]` entries above are cited directly from the
Space Station 14 community wiki. Wiki pages evolve — the content-pipeline
should re-check these URLs periodically and update tags when the
underlying wiki text shifts.

- Medical — <https://wiki.spacestation14.com/wiki/Medical>
- Guide to Medical — <https://wiki.spacestation14.com/wiki/Guide_to_Medical>
- Chemicals — <https://wiki.spacestation14.com/wiki/Chemicals>
- Medibot — <https://wiki.spacestation14.com/wiki/Medibot>
