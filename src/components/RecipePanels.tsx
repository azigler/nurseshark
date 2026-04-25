// Per-medicine recipe panel + Full Rx synthesis order (vs-xvp.3). Renders
// next to the solver output so the medic doesn't have to context-switch to
// the wiki for synthesis steps.
//
// Visual style cross-checked against the hoshizora-sayo bugmedical guide:
// each medicine gets its own collapsible-style block listing batched
// reactions in dependency order with sub-step indentation, then a flat
// "Full Rx" view at the bottom shows the combined raw-input shopping list
// + reaction-order sequence with shared intermediates de-duped.

import { prettifyId, resolveFluentKey } from '../data/fluent';
import {
  buildFullRxPlan,
  buildRecipeTree,
  type FullRxPlan,
  type RecipeStep,
  type RecipeTree,
} from '../data/recipe-builder';
import { type DataBundle, useData } from '../data/store';
import type { SolverIngredient } from '../types';

function reagentName(id: string, data: DataBundle): string {
  const r = data.reagentsById.get(id);
  if (!r) return id;
  return resolveFluentKey(data.fluent, r.name) || prettifyId(r.id);
}

function tempBadge(step: RecipeStep): string | null {
  if (step.minTemp === null && step.maxTemp === null) return null;
  if (step.minTemp !== null && step.maxTemp !== null) {
    return `temp ${step.minTemp}–${step.maxTemp}K`;
  }
  if (step.minTemp !== null) return `hot plate ≥${step.minTemp}K`;
  return `cool ≤${step.maxTemp}K`;
}

/** Render a single batched reaction step (one `RecipeStep`). */
function StepItem({ step, data }: { step: RecipeStep; data: DataBundle }) {
  const temp = tempBadge(step);
  const out = reagentName(step.outputId, data);
  return (
    <li className="recipe-step">
      <div className="recipe-step-head">
        <strong>
          {step.outputUnits}u {out}
        </strong>
        {step.batches > 1 && (
          <span className="recipe-step-batches">×{step.batches} batches</span>
        )}
        {temp && <span className="recipe-step-temp">{temp}</span>}
      </div>
      <ul className="recipe-step-ingredients">
        {step.reactants.map((r) => (
          <li key={r.id}>
            {r.units}u {reagentName(r.id, data)}
          </li>
        ))}
        {step.catalysts.length > 0 &&
          step.catalysts.map((c) => (
            <li key={c.id} className="recipe-step-catalyst">
              {c.amount}u {reagentName(c.id, data)} (catalyst — not consumed)
            </li>
          ))}
      </ul>
    </li>
  );
}

/** Per-medicine panel — one prescribed reagent, its sub-steps. */
function PerMedicinePanel({
  ingredient,
  data,
}: {
  ingredient: SolverIngredient;
  data: DataBundle;
}) {
  const tree: RecipeTree = buildRecipeTree(
    ingredient.reagentId,
    ingredient.units,
    data,
  );
  const name = reagentName(ingredient.reagentId, data);
  if (tree.isFridgeStock) {
    return (
      <section className="recipe-medicine recipe-fridge-stock">
        <h4>
          {ingredient.units}u {name}
        </h4>
        <p className="muted">
          Tier 1 — pull pre-made from the medical fridge / medibot. No synth
          needed.
        </p>
      </section>
    );
  }
  return (
    <section className="recipe-medicine">
      <h4>
        {ingredient.units}u {name}
      </h4>
      <ol className="recipe-steps">
        {tree.steps.map((s, i) => (
          <StepItem key={`${s.reactionId}-${i}`} step={s} data={data} />
        ))}
      </ol>
      {tree.leafInputs.length > 0 && (
        <div className="recipe-leaves">
          <span className="recipe-leaves-label">Inputs to gather: </span>
          {tree.leafInputs
            .map((l) => `${l.units}u ${reagentName(l.id, data)}`)
            .join(', ')}
        </div>
      )}
    </section>
  );
}

/** Full Rx panel — combined synthesis order across the whole prescription. */
function FullRxPanel({ plan, data }: { plan: FullRxPlan; data: DataBundle }) {
  if (
    plan.steps.length === 0 &&
    plan.fridgePulls.length === 0 &&
    plan.rawInputs.length === 0
  ) {
    return null;
  }
  const totalSteps = plan.steps.length;
  return (
    <section className="recipe-full-rx">
      <h3>Full Rx — combined synthesis order</h3>
      {plan.fridgePulls.length > 0 && (
        <div className="recipe-fridge-pulls">
          <h4>Fridge pulls</h4>
          <ul>
            {plan.fridgePulls.map((p) => (
              <li key={p.id}>
                {p.units}u {reagentName(p.id, data)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.rawInputs.length > 0 && (
        <div className="recipe-shopping-list">
          <h4>Chem-dispenser shopping list</h4>
          <ul>
            {plan.rawInputs.map((r) => (
              <li key={r.id}>
                {r.units}u {reagentName(r.id, data)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {totalSteps > 0 && (
        <div className="recipe-synth-order">
          <h4>Reaction order ({totalSteps} steps)</h4>
          <ol className="recipe-steps">
            {plan.steps.map((s, i) => (
              <StepItem key={`${s.reactionId}-${i}`} step={s} data={data} />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

/** Top-level render for the recipe panels block (per-medicine + full-Rx). */
export function RecipePanels({
  ingredients,
}: {
  ingredients: readonly SolverIngredient[];
}) {
  const data = useData();
  if (ingredients.length === 0) return null;

  // Skip the panels entirely if every prescribed reagent is tier-1 fridge
  // stock. The solver-result block already shows what to grab; no synthesis
  // panels to render.
  const anyNeedsSynth = ingredients.some((ing) => ing.tier !== 1);

  const plan = buildFullRxPlan(
    ingredients.map((ing) => ({
      reagentId: ing.reagentId,
      units: ing.units,
    })),
    data,
  );
  return (
    <section className="recipe-panels">
      <h3>Recipes</h3>
      {!anyNeedsSynth && (
        <p className="muted">
          Every prescribed chem is fridge-stock — no synthesis run needed. Pull
          from the medical fridge or medibot.
        </p>
      )}
      {anyNeedsSynth && (
        <>
          <div className="recipe-medicines">
            {ingredients.map((ing) => (
              <PerMedicinePanel
                key={ing.reagentId}
                ingredient={ing}
                data={data}
              />
            ))}
          </div>
          <FullRxPanel plan={plan} data={data} />
        </>
      )}
    </section>
  );
}
