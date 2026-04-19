// /damage — index page listing damage types grouped by their parent group.

import { Link } from 'react-router-dom';
import { DamageBadge } from '../components/DamageBadge';
import { useData } from '../data/store';
import type { DamageType } from '../types';

export function DamagePage() {
  const data = useData();

  // Bucket by group; put ungrouped at the end.
  const byGroup = new Map<string, DamageType[]>();
  for (const d of data.damage) {
    const g = d.group ?? '(none)';
    const arr = byGroup.get(g) ?? [];
    arr.push(d);
    byGroup.set(g, arr);
  }
  const groups = [...byGroup.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <div className="damage-page">
      <header className="page-head">
        <h1>Damage</h1>
        <p className="tagline">
          Every damage type, grouped by the damage group they belong to. Click a
          type to see reagents that heal it.
        </p>
      </header>
      {groups.map(([grp, types]) => (
        <section key={grp} className="damage-group">
          <h2>
            <DamageBadge type={grp} />
          </h2>
          <ul className="damage-type-list">
            {types.map((t) => (
              <li key={t.id}>
                <Link to={`/damage/${t.id}`}>
                  <DamageBadge type={t.id} />
                </Link>{' '}
                {t.treatable ? (
                  <span className="damage-meta">
                    {t.reagentsThatHeal.length} reagent(s) heal
                  </span>
                ) : (
                  <span className="damage-meta muted">
                    (non-treatable / metaphysical)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
