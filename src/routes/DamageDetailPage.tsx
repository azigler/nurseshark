// /damage/:type — drill-down for a specific damage type. Shows:
//   - The type + group
//   - Reagents that explicitly heal THIS type
//   - Reagents that heal via the parent GROUP (expanded)
// Matches the vs-ykc surprise: show both perspectives side-by-side.

import { Link, useParams } from 'react-router-dom';
import { DamageBadge } from '../components/DamageBadge';
import { ReagentCard } from '../components/ReagentCard';
import { useData } from '../data/store';

export function DamageDetailPage() {
  const { type } = useParams<{ type: string }>();
  const data = useData();
  const dt = type ? data.damageById.get(type) : undefined;

  if (!dt) {
    return (
      <div className="damage-missing">
        <h1>Damage type not found</h1>
        <p>
          No damage type with id <code>{type}</code>.
        </p>
        <p>
          <Link to="/damage">← back to damage index</Link>
        </p>
      </div>
    );
  }

  // Direct heals: reagents with an explicit entry matching this type.
  const directHealers = new Set<string>();
  // Group heals: reagents whose heal entry targets the parent group.
  const groupHealers = new Set<string>();
  for (const r of data.reagents) {
    for (const h of r.heals) {
      if (h.kind === 'type' && h.target === dt.id) {
        directHealers.add(r.id);
      } else if (h.kind === 'group' && h.target === dt.group) {
        groupHealers.add(r.id);
      }
    }
  }

  // "reagentsThatHeal" from the damage bundle already unions both — sanity.
  const allHealers = dt.reagentsThatHeal;

  return (
    <div className="damage-detail">
      <header className="page-head">
        <h1>
          <DamageBadge type={dt.id} />
        </h1>
        <p className="tagline">
          {dt.group && (
            <>
              Group: <DamageBadge type={dt.group} linkToPage /> ·{' '}
            </>
          )}
          {allHealers.length} reagent{allHealers.length === 1 ? '' : 's'}{' '}
          recorded as treating this.
        </p>
      </header>

      <section>
        <h2>
          Reagents that heal <code>{dt.id}</code> directly
        </h2>
        {directHealers.size === 0 && <p className="muted">None.</p>}
        <div className="reagent-grid">
          {[...directHealers].sort().map((rid) => {
            const r = data.reagentsById.get(rid);
            if (!r) return null;
            return <ReagentCard key={rid} reagent={r} compact />;
          })}
        </div>
      </section>

      {dt.group && (
        <section>
          <h2>
            Reagents that heal the <DamageBadge type={dt.group} /> group (covers
            this type)
          </h2>
          {groupHealers.size === 0 && <p className="muted">None.</p>}
          <div className="reagent-grid">
            {[...groupHealers].sort().map((rid) => {
              const r = data.reagentsById.get(rid);
              if (!r) return null;
              return <ReagentCard key={rid} reagent={r} compact />;
            })}
          </div>
        </section>
      )}
    </div>
  );
}
