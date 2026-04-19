// /solver — the Rx damage-to-mix solver. Mirrors a health-scanner readout:
// enter damage per type, pick species, toggle filters (Chems / Physical /
// Cryo), and the solver produces a full-heal recipe with per-line
// explanations.
//
// Algorithm lives in src/data/solver.ts — this file is pure UI + wiring.

import { useState } from 'react';
import { CopyLabelButton } from '../components/CopyLabelButton';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { PHYSICAL_ITEMS_BY_ID } from '../data/physical-items';
import { computeMix } from '../data/solver';
import { useData } from '../data/store';
import type {
  DamageProfile,
  DamageTypeId,
  SolverFilters,
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
    };
    setOutput(computeMix(input, data));
  };

  const handleReset = () => {
    setDamage({});
    setOutput(null);
  };

  const anyDamage = Object.values(damage).some((v) => (v ?? 0) > 0);

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
        {output?.solved && (
          <div className="solver-plan">
            {output.ingredients.length > 0 && (
              <>
                <h3>Chem mix</h3>
                <ul className="solver-ingredients">
                  {output.ingredients.map((ing) => {
                    const r = data.reagentsById.get(ing.reagentId);
                    const name = r
                      ? resolveFluentKey(data.fluent, r.name) ||
                        prettifyId(r.id)
                      : ing.reagentId;
                    return (
                      <li key={ing.reagentId} className="solver-ingredient">
                        <div className="solver-ingredient-head">
                          <strong>
                            {ing.units}u {name}
                          </strong>
                        </div>
                        <div className="solver-ingredient-reason">
                          {ing.reason}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {output.physical.length > 0 && (
              <>
                <h3>Physical items</h3>
                <ul className="solver-physical">
                  {output.physical.map((p) => {
                    const it = PHYSICAL_ITEMS_BY_ID.get(p.itemId);
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
      </section>
    </div>
  );
}
