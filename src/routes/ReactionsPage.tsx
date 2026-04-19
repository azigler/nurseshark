// /reactions — browser with free-text filter on reactant/catalyst/product ID
// plus a "min temp > 0" toggle.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../data/store';
import type { Reaction } from '../types';

function reactionMatches(rx: Reaction, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  if (rx.id.toLowerCase().includes(needle)) {
    return true;
  }
  const all = [...rx.reactants, ...rx.catalysts, ...rx.products];
  return all.some((c) => c.id.toLowerCase().includes(needle));
}

export function ReactionsPage() {
  const data = useData();
  const [q, setQ] = useState('');
  const [onlyHot, setOnlyHot] = useState(false);

  const filtered = useMemo(() => {
    return data.reactions.filter((rx) => {
      if (onlyHot && rx.minTemp === null) {
        return false;
      }
      return reactionMatches(rx, q);
    });
  }, [data.reactions, q, onlyHot]);

  return (
    <div className="reactions-page">
      <header className="page-head">
        <h1>Reactions</h1>
        <p className="tagline">
          {data.reactions.length} reactions total. Filter by reactant, catalyst,
          or product ID.
        </p>
      </header>
      <div className="local-filter">
        <input
          type="search"
          placeholder="Filter: id / reactant / catalyst / product..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={onlyHot}
            onChange={(e) => setOnlyHot(e.target.checked)}
          />
          temperature-gated only
        </label>
        <span className="count">
          {filtered.length} / {data.reactions.length}
        </span>
      </div>
      <div className="reaction-list">
        {filtered.map((rx) => (
          <article key={rx.id} id={rx.id} className="reaction-row">
            <h3>
              <Link to={`/reagents/${rx.products[0]?.id ?? rx.id}`}>
                {rx.id}
              </Link>
            </h3>
            <div className="reaction-body">
              <span className="reaction-side">
                {rx.reactants.map((r) => `${r.amount} ${r.id}`).join(' + ') ||
                  '—'}
              </span>
              {rx.catalysts.length > 0 && (
                <span className="reaction-cat">
                  {' '}
                  (cat: {rx.catalysts.map((c) => c.id).join(', ')})
                </span>
              )}
              <span className="reaction-arrow"> → </span>
              <span className="reaction-side">
                {rx.products.map((p) => `${p.amount} ${p.id}`).join(' + ') ||
                  '—'}
              </span>
              {rx.minTemp !== null && (
                <span className="reaction-temp"> @ ≥{rx.minTemp}K</span>
              )}
              {rx.maxTemp !== null && (
                <span className="reaction-temp"> (max {rx.maxTemp}K)</span>
              )}
            </div>
            {rx.conflictsWith.length > 0 && (
              <div className="reaction-warn">
                ⚠ razorium pair: {rx.conflictsWith.join(' + ')}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
