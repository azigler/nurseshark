// /solver — the Rx damage-to-mix solver. Mirrors a health-scanner readout:
// enter damage per type, pick species, toggle filters (Chems / Physical /
// Cryo), and the solver produces a full-heal recipe with per-line
// explanations.
//
// As of vs-xvp.5 the solver returns 2-4 ranked Rx alternatives instead of
// a single "best" pick. The medic picks the card matching their actual
// inventory (fridge-stock / standard medical chems / exotic-allowed).
// Per-medicine recipes + Full Rx synthesis from vs-xvp.3 are retained
// inside each card.
//
// Algorithm lives in src/data/solver.ts — this file is pure UI + wiring.

import { useEffect, useMemo, useState } from 'react';
import { CopyLabelButton } from '../components/CopyLabelButton';
import { RecipePanels } from '../components/RecipePanels';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { computeAlternatives } from '../data/solver';
import { type DataBundle, useData } from '../data/store';
import type {
  DamageProfile,
  DamageTypeId,
  PatientState,
  SolverAlternative,
  SolverAlternatives,
  SolverFilters,
  SolverIngredient,
  SolverInput,
} from '../types';

// Order matching the in-game health scanner readout.
const DAMAGE_FIELDS: ReadonlyArray<{
  id: DamageTypeId;
  label: string;
  group: string;
}> = [
  { id: 'Blunt', label: 'Blunt', group: 'Brute' },
  { id: 'Piercing', label: 'Piercing', group: 'Brute' },
  { id: 'Slash', label: 'Slash', group: 'Brute' },
  { id: 'Heat', label: 'Heat', group: 'Burn' },
  { id: 'Cold', label: 'Cold', group: 'Burn' },
  { id: 'Shock', label: 'Shock', group: 'Burn' },
  { id: 'Poison', label: 'Poison', group: 'Toxin' },
  { id: 'Caustic', label: 'Caustic', group: 'Toxin' },
  { id: 'Radiation', label: 'Radiation', group: 'Toxin' },
  { id: 'Cellular', label: 'Cellular', group: 'Genetic' },
  { id: 'Bloodloss', label: 'Bloodloss', group: 'Airloss' },
  { id: 'Asphyxiation', label: 'Asphyxiation', group: 'Airloss' },
];

const SPECIES_OPTIONS: readonly string[] = [
  'Human',
  'Moth',
  'Vox',
  'Diona',
  'SlimePerson',
  'Reptilian',
  'Vulpkanin',
  'Dwarf',
  'Arachnid',
];

const PATIENT_STATES: ReadonlyArray<{ id: PatientState; label: string }> = [
  { id: 'alive', label: 'Alive' },
  { id: 'critical', label: 'Critical' },
  { id: 'dead', label: 'Dead' },
];

/**
 * localStorage key for the medic's last-chosen card index (vs-xvp.5).
 * Stored as a tier-ceiling number (1/2/3) rather than an array index so
 * the preference survives even when adjacent-duplicate suppression
 * changes the visible card count.
 */
const PREFERRED_TIER_KEY = 'nurseshark.solver.preferredTier';

function loadPreferredTier(): 1 | 2 | 3 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PREFERRED_TIER_KEY);
    const n = raw === null ? null : Number.parseInt(raw, 10);
    if (n === 1 || n === 2 || n === 3) return n;
    return null;
  } catch {
    return null;
  }
}

function savePreferredTier(tier: 1 | 2 | 3): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFERRED_TIER_KEY, String(tier));
  } catch {
    // localStorage may be disabled (Safari private mode etc) — silently
    // skip persistence rather than crashing the solver.
  }
}

/**
 * Map a tier-ceiling preference back to an index in the alternatives
 * list, falling back to the alternatives' own `defaultIndex` when the
 * preferred tier isn't represented (suppressed by duplicate detection).
 */
function indexForPreferredTier(
  alternatives: readonly SolverAlternative[],
  preferred: 1 | 2 | 3 | null,
  fallbackIndex: number,
): number {
  if (preferred === null) return fallbackIndex;
  const idx = alternatives.findIndex((a) => a.tierCeiling === preferred);
  return idx === -1 ? fallbackIndex : idx;
}

/**
 * Shared renderer for a single chem ingredient panel. Used both by the
 * standard (alive/critical) output and by the dead-mode post-revival panel.
 * Pulled out of SolverPage's JSX so the 3-panel dead-mode layout can reuse
 * the same visual treatment for its post-revival chems.
 */
function IngredientList({
  ingredients,
  data,
}: {
  ingredients: readonly SolverIngredient[];
  data: DataBundle;
}) {
  return (
    <ul className="solver-ingredients">
      {ingredients.map((ing) => {
        const r = data.reagentsById.get(ing.reagentId);
        const name = r
          ? resolveFluentKey(data.fluent, r.name) || prettifyId(r.id)
          : ing.reagentId;
        const tierLabel =
          ing.tier === 1
            ? 'Tier 1 · fridge stock'
            : ing.tier === 2
              ? 'Tier 2 · synth'
              : 'Tier 3 · exotic';
        return (
          <li key={ing.reagentId} className="solver-ingredient">
            <div className="solver-ingredient-head">
              <strong>
                {ing.units}u {name}
              </strong>
              <span
                className={`solver-tier-badge tier-${ing.tier}`}
                title={tierLabel}
              >
                {tierLabel}
              </span>
            </div>
            <div className="solver-ingredient-reason">{ing.reason}</div>
            {ing.tierReason && (
              <div className="solver-tier-reason">{ing.tierReason}</div>
            )}
            {ing.sideEffectWarnings.length > 0 && (
              <ul className="solver-ingredient-warnings">
                {ing.sideEffectWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Render a single chem-mix Rx (alive / critical mode) — the body of an
 * alternative card. The card chrome (header + collapsed/expanded toggle)
 * is rendered by `RxCard`.
 */
function StandardRxBody({
  alternative,
  data,
  operator,
}: {
  alternative: SolverAlternative;
  data: DataBundle;
  operator: string;
}) {
  const output = alternative.output;
  return (
    <div className="solver-plan">
      {output.ingredients.length > 0 && (
        <>
          <h4>Chem mix</h4>
          <IngredientList ingredients={output.ingredients} data={data} />
        </>
      )}

      {output.physical.length > 0 && (
        <>
          <h4>Physical items</h4>
          <ul className="solver-physical">
            {output.physical.map((p) => {
              const it = data.physicalItemsById.get(p.itemId);
              return (
                <li key={p.itemId}>
                  <strong>
                    {p.count}× {it?.name ?? p.itemId}
                  </strong>
                  <div className="solver-ingredient-reason">{p.reason}</div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {output.cryo && (
        <>
          <h4>Cryo flow</h4>
          <div className="solver-cryo">
            <strong>
              {output.cryo.units}u {output.cryo.reagentId} @{' '}
              {output.cryo.targetTemp}K
            </strong>
            <div className="solver-ingredient-reason">{output.cryo.reason}</div>
          </div>
        </>
      )}

      {output.estimatedTimeSec !== null && (
        <p className="solver-time muted">
          Estimated time to full heal: ~{output.estimatedTimeSec}s
        </p>
      )}

      {output.warnings.length > 0 && (
        <div className="solver-warnings">
          <h4>Warnings</h4>
          <ul>
            {output.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {output.label && (
        <div className="solver-label-row">
          <div className="solver-label-preview">
            <code>{output.label}</code>
          </div>
          {output.ingredients[0] && (
            <CopyLabelButton
              reagentId={output.ingredients[0].reagentId}
              units={output.ingredients[0].units}
              operatorName={operator || undefined}
              registerGlobalCopy
            />
          )}
        </div>
      )}

      {output.ingredients.length > 0 && (
        <RecipePanels ingredients={output.ingredients} />
      )}
    </div>
  );
}

/**
 * Render the dead-patient 3-panel revival flow inside a card. This is
 * the same layout as the pre-vs-xvp.5 standalone dead-mode block —
 * `computeAlternatives` wraps it as a single-card alternative for
 * uniform handling.
 */
function DeadModeBody({
  alternative,
  data,
  operator,
}: {
  alternative: SolverAlternative;
  data: DataBundle;
  operator: string;
}) {
  const output = alternative.output;
  const canRevive = output.revivalStep !== undefined;
  return (
    <div className="solver-plan solver-plan-revival">
      {output.patientStateWarnings &&
        output.patientStateWarnings.length > 0 && (
          <div className="solver-revival-advisories">
            <ul>
              {output.patientStateWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

      {/* Panel 1: Topicals. */}
      <section className="solver-revival-panel solver-revival-topicals">
        <h4>1. Topicals — reduce damage below 200</h4>
        {output.physical.length > 0 ? (
          <ul className="solver-physical">
            {output.physical.map((p) => {
              const it = data.physicalItemsById.get(p.itemId);
              return (
                <li key={p.itemId}>
                  <strong>
                    {p.count}× {it?.name ?? p.itemId}
                  </strong>
                  <div className="solver-ingredient-reason">{p.reason}</div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">
            Patient already below 200 total damage — no topicals required before
            defibrillation.
          </p>
        )}
      </section>

      {/* Panel 2: Defibrillator. Emitted only when revival is possible. */}
      {canRevive && output.revivalStep && (
        <section className="solver-revival-panel solver-revival-defib">
          <h4>2. Defibrillate</h4>
          <div className="solver-revival-step">
            <strong>{output.revivalStep.tool}</strong>
            <div className="solver-ingredient-reason">
              Heals{' '}
              {Object.entries(output.revivalStep.heals)
                .map(([k, v]) => `${v} ${k}`)
                .join(', ')}
              ; inflicts{' '}
              {Object.entries(output.revivalStep.inflicts)
                .map(([k, v]) => `${v} ${k}`)
                .join(', ')}
              .
            </div>
            <div className="solver-ingredient-reason">
              {output.revivalStep.note}
            </div>
          </div>
        </section>
      )}

      {/* Panel 3: Post-revival chems. Emitted only when revival succeeded. */}
      {canRevive &&
        output.postRevivalIngredients &&
        output.postRevivalIngredients.length > 0 && (
          <section className="solver-revival-panel solver-revival-postchems">
            <h4>3. Post-revival chems</h4>
            <IngredientList
              ingredients={output.postRevivalIngredients}
              data={data}
            />
            <RecipePanels ingredients={output.postRevivalIngredients} />
          </section>
        )}

      {!canRevive && (
        <section className="solver-revival-panel solver-revival-blocked">
          <h4>Revival blocked</h4>
          <p>
            Topicals alone cannot reduce total damage below the 200 threshold.
            Consult CMO for advanced options (cryo, surgery, genetic
            restoration).
          </p>
        </section>
      )}

      {output.estimatedTimeSec !== null && (
        <p className="solver-time muted">
          Estimated post-revival heal time: ~{output.estimatedTimeSec}s
        </p>
      )}

      {output.warnings.length > 0 && (
        <div className="solver-warnings">
          <h4>Post-revival warnings</h4>
          <ul>
            {output.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {output.label && canRevive && (
        <div className="solver-label-row">
          <div className="solver-label-preview">
            <code>{output.label}</code>
          </div>
          {output.postRevivalIngredients?.[0] && (
            <CopyLabelButton
              reagentId={output.postRevivalIngredients[0].reagentId}
              units={output.postRevivalIngredients[0].units}
              operatorName={operator || undefined}
              registerGlobalCopy
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Card chrome around a single Rx alternative. Renders an expandable
 * header with the trade-off summary; the body shows the full Rx when
 * expanded.
 */
function RxCard({
  alternative,
  data,
  operator,
  index,
  expanded,
  onToggle,
  isDead,
}: {
  alternative: SolverAlternative;
  data: DataBundle;
  operator: string;
  index: number;
  expanded: boolean;
  onToggle: (idx: number) => void;
  isDead: boolean;
}) {
  const headLabel =
    alternative.kind === 'fridge-stock'
      ? 'Fridge stock'
      : alternative.kind === 'standard'
        ? 'Standard chems'
        : 'Exotic-allowed';
  const totalUnits = alternative.totalUnits;
  const ingCount = alternative.output.ingredients.length;
  return (
    <section
      className={`solver-rx-card tier-${alternative.tierCeiling}${
        expanded ? ' is-expanded' : ' is-collapsed'
      }${alternative.partial ? ' is-partial' : ''}`}
      data-testid={`solver-rx-card-${alternative.tierCeiling}`}
    >
      <button
        type="button"
        className="solver-rx-card-head"
        aria-expanded={expanded}
        onClick={() => onToggle(index)}
      >
        <span className="solver-rx-card-tier">
          Tier ≤ {alternative.tierCeiling}
        </span>
        <span className="solver-rx-card-label">{headLabel}</span>
        {alternative.partial && (
          <span className="solver-rx-card-partial-badge">partial coverage</span>
        )}
        {!isDead && (
          <span className="solver-rx-card-stats muted">
            {ingCount} chem{ingCount === 1 ? '' : 's'} · {totalUnits}u total
          </span>
        )}
        <span className="solver-rx-card-toggle" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      <div className="solver-rx-card-summary">{alternative.summary}</div>
      {expanded && (
        <div className="solver-rx-card-body">
          {isDead ? (
            <DeadModeBody
              alternative={alternative}
              data={data}
              operator={operator}
            />
          ) : (
            <StandardRxBody
              alternative={alternative}
              data={data}
              operator={operator}
            />
          )}
        </div>
      )}
    </section>
  );
}

export function SolverPage() {
  const data = useData();
  const [damage, setDamage] = useState<DamageProfile>({});
  const [species, setSpecies] = useState<string>('Human');
  const [filters, setFilters] = useState<SolverFilters>({
    chems: true,
    physical: true,
    cryo: true,
  });
  const [operator, setOperator] = useState<string>('');
  const [patientState, setPatientState] = useState<PatientState>('alive');
  const [alternatives, setAlternatives] = useState<SolverAlternatives | null>(
    null,
  );
  const [expandedIndex, setExpandedIndex] = useState<number>(0);

  // Restore preferred tier from localStorage on mount. The actual index is
  // resolved against the current alternatives list when one exists.
  const initialPreferredTier = useMemo(() => loadPreferredTier(), []);

  // When alternatives update, default-expand the medic's preferred tier
  // (if represented) or the solver-computed default index.
  useEffect(() => {
    if (alternatives === null) return;
    setExpandedIndex(
      indexForPreferredTier(
        alternatives.alternatives,
        initialPreferredTier,
        alternatives.defaultIndex,
      ),
    );
  }, [alternatives, initialPreferredTier]);

  const handleDamageChange = (id: DamageTypeId, value: number) => {
    setDamage((prev) => ({ ...prev, [id]: value }));
  };

  const handleSolve = (e: React.FormEvent) => {
    e.preventDefault();
    const input: SolverInput = {
      damage,
      species,
      filters,
      operatorName: operator || undefined,
      patientState,
    };
    setAlternatives(computeAlternatives(input, data));
  };

  const handleReset = () => {
    setDamage({});
    setAlternatives(null);
  };

  const handleCardToggle = (idx: number) => {
    setExpandedIndex((prev) => (prev === idx ? -1 : idx));
    const picked = alternatives?.alternatives[idx];
    if (picked) {
      savePreferredTier(picked.tierCeiling);
    }
  };

  const anyDamage = Object.values(damage).some((v) => (v ?? 0) > 0);
  const isDeadMode = patientState === 'dead';

  // The "no damage" / unsolved sentinel: when the first alternative's
  // output reports `solved: false`, we show the same warnings block as
  // before instead of the card list.
  const firstAlt = alternatives?.alternatives[0];
  const isUnsolved = firstAlt?.output.solved === false;

  return (
    <div className="solver-page">
      <header className="page-head">
        <h1>Rx Solver</h1>
        <p className="tagline">
          Enter what the health scanner shows. Pick species. The solver returns
          ranked Rx alternatives — fridge stock, standard medical chems, or
          exotic-allowed — so you can pick the one that matches your inventory.
        </p>
      </header>

      <form className="solver-form solver-form-rx" onSubmit={handleSolve}>
        <fieldset className="solver-fieldset solver-filters">
          <legend>Output filters</legend>
          <label className="solver-toggle">
            <input
              type="checkbox"
              checked={filters.chems}
              onChange={(e) =>
                setFilters({ ...filters, chems: e.target.checked })
              }
            />
            <span>Chems</span>
          </label>
          <label className="solver-toggle">
            <input
              type="checkbox"
              checked={filters.physical}
              onChange={(e) =>
                setFilters({ ...filters, physical: e.target.checked })
              }
            />
            <span>Physical</span>
          </label>
          <label className="solver-toggle">
            <input
              type="checkbox"
              checked={filters.cryo}
              onChange={(e) =>
                setFilters({ ...filters, cryo: e.target.checked })
              }
            />
            <span>Cryo</span>
          </label>
        </fieldset>

        <fieldset className="solver-fieldset solver-species-field">
          <legend>Species</legend>
          <select
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            aria-label="Species"
          >
            {SPECIES_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'SlimePerson' ? 'Slime' : s}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className="solver-fieldset solver-patient-state-field">
          <legend>Patient state</legend>
          <select
            value={patientState}
            onChange={(e) => setPatientState(e.target.value as PatientState)}
            aria-label="Patient state"
          >
            {PATIENT_STATES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className="solver-fieldset solver-damage-grid">
          <legend>Damage</legend>
          {DAMAGE_FIELDS.map((f) => (
            <label key={f.id} className="solver-damage-field">
              <span className="solver-damage-label">
                {f.label}
                <small className="solver-damage-group"> · {f.group}</small>
              </span>
              <input
                type="number"
                min={0}
                max={500}
                step={1}
                value={damage[f.id] ?? ''}
                placeholder="0"
                onChange={(e) =>
                  handleDamageChange(f.id, Number(e.target.value) || 0)
                }
              />
            </label>
          ))}
          <p className="solver-damage-footnote">
            Holy damage: cult-only, chaplain's domain, not Nurseshark's.
          </p>
        </fieldset>

        <fieldset className="solver-fieldset solver-operator-field">
          <legend>Operator (for label)</legend>
          <input
            type="text"
            placeholder="e.g. Andrew Zigler"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
          />
        </fieldset>

        <div className="solver-actions">
          <button type="submit" disabled={!anyDamage} className="primary">
            Compute mix
          </button>
          <button type="button" className="linklike" onClick={handleReset}>
            reset
          </button>
        </div>
      </form>

      <section className="solver-result" aria-live="polite">
        <h2>Result</h2>
        {alternatives === null && (
          <p className="muted">
            Fill in damage values above (at least one) and click "Compute mix".
          </p>
        )}
        {alternatives !== null && isUnsolved && firstAlt && (
          <div className="notice notice-pending">
            <ul>
              {firstAlt.output.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {alternatives !== null && !isUnsolved && (
          <div
            className={`solver-rx-cards${isDeadMode ? ' solver-rx-cards-dead' : ''}`}
          >
            {alternatives.alternatives.length > 1 && (
              <p className="solver-rx-cards-tagline muted">
                {alternatives.alternatives.length} ranked alternatives — pick
                the card matching your inventory. Click any header to expand.
              </p>
            )}
            {alternatives.alternatives.map((alt, idx) => (
              <RxCard
                key={alt.tierCeiling}
                alternative={alt}
                data={data}
                operator={operator}
                index={idx}
                expanded={expandedIndex === idx}
                onToggle={handleCardToggle}
                isDead={isDeadMode}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
