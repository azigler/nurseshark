// /solver — the Rx solver UI shell. vs-4sl (this bead) builds the form,
// result panel skeleton, and wiring. vs-2wj will swap in the real
// `computeMix()` implementation. DO NOT implement the solver algorithm here.
//
// The form takes a target reagent + desired units + optional operator name.
// The result panel shows the stub output + a "not-yet-computed" notice.

import { useState } from 'react';
import { CopyLabelButton } from '../components/CopyLabelButton';
import { ReagentCard } from '../components/ReagentCard';
import { SearchBar, type SearchHit } from '../components/SearchBar';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { useData } from '../data/store';
import type { SolverInput, SolverOutput } from '../types';

/**
 * Stub solver. vs-2wj replaces this with the real algorithm.
 *
 * DO NOT IMPLEMENT LOGIC HERE. Keep it returning an empty output so the UI
 * obviously shows the "not-yet-computed" state.
 */
function computeMix(_input: SolverInput): SolverOutput {
  return {
    ingredients: [],
    steps: [],
    warnings: [
      'Solver not yet implemented. vs-2wj will wire the real algorithm into this function.',
    ],
    label: '',
    solved: false,
  };
}

export function SolverPage() {
  const data = useData();
  const [target, setTarget] = useState<string | null>(null);
  const [units, setUnits] = useState<number>(30);
  const [operator, setOperator] = useState<string>('');
  const [output, setOutput] = useState<SolverOutput | null>(null);

  const targetReagent = target ? data.reagentsById.get(target) : null;
  const targetLabel = targetReagent
    ? resolveFluentKey(data.fluent, targetReagent.name) ||
      prettifyId(targetReagent.id)
    : '';

  const handleSelect = (hit: SearchHit) => {
    if (hit.kind === 'reagent') {
      setTarget(hit.id);
    }
  };

  const handleSolve = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) {
      return;
    }
    const result = computeMix({ target, units, operatorName: operator });
    setOutput(result);
  };

  return (
    <div className="solver-page">
      <header className="page-head">
        <h1>Rx Solver</h1>
        <p className="tagline">
          Pick a target reagent + units, get a mix plan. The solver algorithm is
          implemented by the sibling bead vs-2wj — this page is the UI shell.
        </p>
      </header>

      <form className="solver-form" onSubmit={handleSolve}>
        <div className="solver-field">
          <div className="solver-label">Target reagent</div>
          <SearchBar
            onlyKind="reagent"
            placeholder={target ? targetLabel : 'Bicaridine, Omnizine, …'}
            onSelect={handleSelect}
            className="solver-search"
          />
          {target && (
            <div className="solver-target-current">
              Currently: <strong>{targetLabel}</strong>{' '}
              <button
                type="button"
                className="linklike"
                onClick={() => setTarget(null)}
              >
                clear
              </button>
            </div>
          )}
        </div>
        <label className="solver-field">
          <span className="solver-label">Units (u)</span>
          <input
            type="number"
            min={1}
            max={1000}
            step={1}
            value={units}
            onChange={(e) => setUnits(Number(e.target.value) || 0)}
          />
        </label>
        <label className="solver-field">
          <span className="solver-label">Operator (for label)</span>
          <input
            type="text"
            placeholder="e.g. Andrew Zigler"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
          />
        </label>
        <div className="solver-actions">
          <button type="submit" disabled={!target} className="primary">
            Compute mix
          </button>
        </div>
      </form>

      <section className="solver-result" aria-live="polite">
        <h2>Result</h2>
        {output === null && (
          <p className="muted">Fill in the form and click "Compute mix".</p>
        )}
        {output !== null && !output.solved && (
          <div className="notice notice-pending">
            <strong>Solver stub:</strong>
            <ul>
              {output.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            {target && targetReagent && (
              <div className="solver-target-card">
                <p>
                  While we wait for vs-2wj, here's the reagent you selected:
                </p>
                <ReagentCard reagent={targetReagent} />
                <div className="solver-copy">
                  <CopyLabelButton
                    reagentId={target}
                    units={units}
                    operatorName={operator || undefined}
                    registerGlobalCopy
                  />
                </div>
              </div>
            )}
          </div>
        )}
        {output?.solved && (
          <div className="solver-plan">
            <h3>Ingredients</h3>
            <ul>
              {output.ingredients.map((ing) => (
                <li key={ing.reagentId}>
                  {ing.units}u {ing.reagentId}
                </li>
              ))}
            </ul>
            <h3>Steps</h3>
            <ol>
              {output.steps.map((s, idx) => (
                <li key={`step-${idx}`}>
                  <code>{s.kind}</code> — {s.text}
                </li>
              ))}
            </ol>
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
            <div>{output.label}</div>
          </div>
        )}
      </section>
    </div>
  );
}
