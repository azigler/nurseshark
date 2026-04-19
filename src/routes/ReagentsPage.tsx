// /reagents — grid of every reagent as a card, with a local filter box.
// The global header search already navigates straight to a reagent; this
// page's filter scopes results to the grid without leaving the page.

import { useMemo, useState } from 'react';
import { ReagentCard } from '../components/ReagentCard';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { useData } from '../data/store';

export function ReagentsPage() {
  const data = useData();
  const [q, setQ] = useState('');

  const reagents = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      return data.reagents;
    }
    return data.reagents.filter((r) => {
      const label = (
        resolveFluentKey(data.fluent, r.name) || prettifyId(r.id)
      ).toLowerCase();
      return label.includes(needle) || r.id.toLowerCase().includes(needle);
    });
  }, [data, q]);

  return (
    <div className="reagents-page">
      <header className="page-head">
        <h1>Reagents</h1>
        <p className="tagline">
          {data.reagents.length} reagents total. Click a card for the full
          detail view.
        </p>
      </header>
      <div className="local-filter">
        <input
          type="search"
          placeholder="Filter reagents..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="count">
          {reagents.length} / {data.reagents.length}
        </span>
      </div>
      <div className="reagent-grid">
        {reagents.map((r) => (
          <ReagentCard key={r.id} reagent={r} />
        ))}
      </div>
    </div>
  );
}
