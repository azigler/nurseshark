// Full reagent detail panel. Used on /reagents/:id and also intended for
// tooltip/hover content over solver output lines (vs-2wj's solver).
//
// Renders: name, description, physical desc, color swatch, metabolism rate,
// heals list (with group expansion), conflicts, and the set of reactions
// that produce + consume the reagent.

import { Link } from 'react-router-dom';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { useData } from '../data/store';
import type { Reagent } from '../types';
import { CopyLabelButton } from './CopyLabelButton';
import { DamageBadge } from './DamageBadge';
import { ReagentSprite } from './ReagentSprite';

export function ReagentDetail({ reagent }: { reagent: Reagent }) {
  const data = useData();
  const displayName =
    resolveFluentKey(data.fluent, reagent.name) || prettifyId(reagent.id);
  const desc = reagent.desc
    ? resolveFluentKey(data.fluent, reagent.desc)
    : null;
  const physical = reagent.physicalDesc
    ? resolveFluentKey(data.fluent, reagent.physicalDesc)
    : null;
  const producedBy = data.reactionsProducing.get(reagent.id) ?? [];
  const consumedBy = data.reactionsConsuming.get(reagent.id) ?? [];

  // Expand group heal entries into their members for display.
  interface ExpandedHeal {
    target: string;
    amountPerTick: number;
    viaGroup: string | null;
  }
  const expanded: ExpandedHeal[] = [];
  for (const h of reagent.heals) {
    if (h.kind === 'type') {
      expanded.push({
        target: h.target,
        amountPerTick: h.amountPerTick,
        viaGroup: null,
      });
    } else {
      const members = data.damageGroupMembers.get(h.target) ?? [];
      if (members.length === 0) {
        expanded.push({
          target: h.target,
          amountPerTick: h.amountPerTick,
          viaGroup: null,
        });
      }
      for (const m of members) {
        expanded.push({
          target: m,
          amountPerTick: h.amountPerTick,
          viaGroup: h.target,
        });
      }
    }
  }

  return (
    <article className="reagent-detail">
      <header className="reagent-detail-head">
        <ReagentSprite reagentId={reagent.id} size={48} />
        <div className="reagent-detail-title">
          <h1>{displayName}</h1>
          <div className="reagent-detail-meta">
            <code>{reagent.id}</code>
            {reagent.group && (
              <span className="meta-group">group: {reagent.group}</span>
            )}
            {reagent.color && (
              <span
                className="meta-color"
                style={{ background: reagent.color }}
                title={reagent.color}
              />
            )}
            <span className="meta-metabolism">
              metab: {reagent.metabolismRate}u/tick
            </span>
          </div>
        </div>
        <CopyLabelButton reagentId={reagent.id} units={30} registerGlobalCopy />
      </header>

      {desc && <p className="reagent-detail-desc">{desc}</p>}
      {physical && (
        <p className="reagent-detail-physical">
          <em>Tastes/feels:</em> {physical}
        </p>
      )}

      {expanded.length > 0 && (
        <section>
          <h2>Heals</h2>
          <ul className="heal-list">
            {expanded.map((h) => (
              <li key={`${h.viaGroup ?? ''}-${h.target}`}>
                <DamageBadge type={h.target} linkToPage />
                <span className="heal-amount">
                  {' '}
                  {h.amountPerTick.toFixed(2)} per tick
                </span>
                {h.viaGroup && (
                  <span className="heal-via"> (via group {h.viaGroup})</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {reagent.conflictsWith.length > 0 && (
        <section className="conflicts">
          <h2>⚠ Conflicts (razorium-producing)</h2>
          <p>Never mix with:</p>
          <ul>
            {reagent.conflictsWith.map((c) => (
              <li key={c}>
                <Link to={`/reagents/${c}`}>{c}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {producedBy.length > 0 && (
        <section>
          <h2>Produced by ({producedBy.length})</h2>
          <ul className="reaction-list">
            {producedBy.map((rx) => (
              <li key={rx.id}>
                <Link to={`/reactions#${rx.id}`}>{rx.id}</Link>:{' '}
                {rx.reactants.map((r) => `${r.amount} ${r.id}`).join(' + ')}
                {rx.catalysts.length > 0 &&
                  ` (cat: ${rx.catalysts.map((c) => c.id).join(', ')})`}
                {rx.minTemp !== null && ` @ ≥${rx.minTemp}K`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {consumedBy.length > 0 && (
        <section>
          <h2>Used in ({consumedBy.length})</h2>
          <ul className="reaction-list">
            {consumedBy.slice(0, 20).map((rx) => (
              <li key={rx.id}>
                <Link to={`/reactions#${rx.id}`}>{rx.id}</Link>{' '}
                {rx.products.length > 0 &&
                  `→ ${rx.products.map((p) => p.id).join(', ')}`}
              </li>
            ))}
            {consumedBy.length > 20 && (
              <li>
                <em>…and {consumedBy.length - 20} more</em>
              </li>
            )}
          </ul>
        </section>
      )}
    </article>
  );
}
