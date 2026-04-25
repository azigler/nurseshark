// /solver — the Rx damage-to-mix solver. Mirrors a health-scanner readout:
// enter damage per type, pick species, toggle filters (Chems / Physical /
// Cryo), and the solver produces a full-heal recipe with per-line
// explanations.
//
// Algorithm lives in src/data/solver.ts — this file is pure UI + wiring.

import { useState } from 'react';
import { CopyLabelButton } from '../components/CopyLabelButton';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { computeMix } from '../data/solver';
import { type DataBundle, useData } from '../data/store';
import type {
  DamageProfile,
  DamageTypeId,
  PatientState,
  SolverFilters,
  SolverIngredient,
  SolverInput,
  SolverOutput,
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
  const [output, setOutput] = useState<SolverOutput | null>(null);

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
    setOutput(computeMix(input, data));
  };

  const handleReset = () => {
    setDamage({});
    setOutput(null);
  };

  const anyDamage = Object.values(damage).some((v) => (v ?? 0) > 0);
  const isDeadMode = patientState === 'dead' && output?.solved === true;
  const canRevive = isDeadMode && output?.revivalStep !== undefined;

  return (
    <div className="solver-page">
      <header className="page-head">
        <h1>Rx Solver</h1>
        <p className="tagline">
          Enter what the health scanner shows. Pick species. Get a full-heal
          recipe — chem mix, physical items, and cryo flow, tuned to the
          patient's damage profile.
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
        {output === null && (
          <p className="muted">
            Fill in damage values above (at least one) and click "Compute mix".
          </p>
        )}
        {output !== null && !output.solved && (
          <div className="notice notice-pending">
            <ul>
              {output.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {output?.solved && !isDeadMode && (
          <div className="solver-plan">
            {output.ingredients.length > 0 && (
              <>
                <h3>Chem mix</h3>
                <IngredientList ingredients={output.ingredients} data={data} />
              </>
            )}

            {output.physical.length > 0 && (
              <>
                <h3>Physical items</h3>
                <ul className="solver-physical">
                  {output.physical.map((p) => {
                    const it = data.physicalItemsById.get(p.itemId);
                    return (
                      <li key={p.itemId}>
                        <strong>
                          {p.count}× {it?.name ?? p.itemId}
                        </strong>
                        <div className="solver-ingredient-reason">
                          {p.reason}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {output.cryo && (
              <>
                <h3>Cryo flow</h3>
                <div className="solver-cryo">
                  <strong>
                    {output.cryo.units}u {output.cryo.reagentId} @{' '}
                    {output.cryo.targetTemp}K
                  </strong>
                  <div className="solver-ingredient-reason">
                    {output.cryo.reason}
                  </div>
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
                <h3>Warnings</h3>
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
          </div>
        )}

        {isDeadMode && output && (
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
              <h3>1. Topicals — reduce damage below 200</h3>
              {output.physical.length > 0 ? (
                <ul className="solver-physical">
                  {output.physical.map((p) => {
                    const it = data.physicalItemsById.get(p.itemId);
                    return (
                      <li key={p.itemId}>
                        <strong>
                          {p.count}× {it?.name ?? p.itemId}
                        </strong>
                        <div className="solver-ingredient-reason">
                          {p.reason}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">
                  Patient already below 200 total damage — no topicals required
                  before defibrillation.
                </p>
              )}
            </section>

            {/* Panel 2: Defibrillator. Emitted only when revival is possible. */}
            {canRevive && output.revivalStep && (
              <section className="solver-revival-panel solver-revival-defib">
                <h3>2. Defibrillate</h3>
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
                  <h3>3. Post-revival chems</h3>
                  <IngredientList
                    ingredients={output.postRevivalIngredients}
                    data={data}
                  />
                </section>
              )}

            {!canRevive && (
              <section className="solver-revival-panel solver-revival-blocked">
                <h3>Revival blocked</h3>
                <p>
                  Topicals alone cannot reduce total damage below the 200
                  threshold. Consult CMO for advanced options (cryo, surgery,
                  genetic restoration).
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
                <h3>Post-revival warnings</h3>
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
        )}
      </section>
    </div>
  );
}
