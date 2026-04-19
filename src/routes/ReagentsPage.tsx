// /reagents — grid of every reagent as a card, with a local filter box.
// The global header search already navigates straight to a reagent; this
// page's filter scopes results to the grid without leaving the page.
//
// Default view hides reagents in `REAGENT_BLACKLIST` (admin-spawn /
// uncraftable reagents like Rororium and Omnizine). A toggle above the
// grid lets the curious see everything, with a per-card badge showing
// the restriction reason.

import { useMemo, useState } from 'react';
import { ReagentCard } from '../components/ReagentCard';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { isBlacklisted } from '../data/reagent-blacklist';
import { useData } from '../data/store';

export function ReagentsPage() {
  const data = useData();
  const [q, setQ] = useState('');
  const [showRestricted, setShowRestricted] = useState(false);

  const reagents = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = data.reagents;
    if (!showRestricted) {
      pool = pool.filter((r) => !isBlacklisted(r.id));
    }
    if (!needle) return pool;
    return pool.filter((r) => {
      const label = (
        resolveFluentKey(data.fluent, r.name) || prettifyId(r.id)
      ).toLowerCase();
      return label.includes(needle) || r.id.toLowerCase().includes(needle);
    });
  }, [data, q, showRestricted]);

  const totalCount = data.reagents.length;
  const visiblePool = showRestricted
    ? totalCount
    : data.reagents.filter((r) => !isBlacklisted(r.id)).length;

  return (
    <div className="reagents-page">
      <header className="page-head">
        <h1>Reagents</h1>
        <p className="tagline">
          {visiblePool} reagents shown
          {showRestricted ? '' : ` (${totalCount - visiblePool} hidden)`}. Click
          a card for the full detail view.
        </p>
      </header>
      <div className="local-filter">
        <input
          type="search"
          placeholder="Filter reagents..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={showRestricted}
            onChange={(e) => setShowRestricted(e.target.checked)}
          />
          Show admin / rare reagents
        </label>
        <span className="count">
          {reagents.length} / {visiblePool}
        </span>
      </div>
      <div className="reagent-grid">
        {reagents.map((r) => (
          <ReagentCard key={r.id} reagent={r} showBlacklistBadge />
        ))}
      </div>
    </div>
  );
}
