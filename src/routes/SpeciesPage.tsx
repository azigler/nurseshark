// /species — cards per species, with the guidebook notes as a collapsible
// expandable (default: collapsed, click to expand).

import { useState } from 'react';
import { SpeciesBadge } from '../components/SpeciesBadge';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { useData } from '../data/store';

function renderNotes(notes: string) {
  // Notes are plain text (BBCode stripped) — honor `\n\n` as paragraph
  // breaks. Skip leading markdown headings (they'd produce weird spacing).
  const paragraphs = notes
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((para, idx) => {
    if (para.startsWith('# ')) {
      return null; // redundant with the heading on the card
    }
    if (para.startsWith('## ')) {
      return <h3 key={`p-${idx}`}>{para.replace(/^##\s+/, '')}</h3>;
    }
    return <p key={`p-${idx}`}>{para}</p>;
  });
}

export function SpeciesPage() {
  const data = useData();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="species-page">
      <header className="page-head">
        <h1>Species</h1>
        <p className="tagline">
          Per-species medical notes. Click a card to expand the guidebook
          excerpt.
        </p>
      </header>
      <div className="species-grid">
        {data.species.map((s) => {
          const name = s.nameKey
            ? resolveFluentKey(data.fluent, s.nameKey)
            : prettifyId(s.id);
          const isOpen = expanded.has(s.id);
          return (
            <article
              key={s.id}
              id={s.id}
              className={`species-card ${isOpen ? 'open' : ''}`}
            >
              <button
                type="button"
                className="species-card-head"
                onClick={() => toggle(s.id)}
                aria-expanded={isOpen}
              >
                <span className="species-card-heading">
                  <SpeciesBadge speciesId={s.id} />
                </span>
                <span className="species-toggle">{isOpen ? '▾' : '▸'}</span>
              </button>
              <div className="species-card-meta">
                <code>{s.id}</code>
                {s.prototype && (
                  <span>
                    {' '}
                    · proto <code>{s.prototype}</code>
                  </span>
                )}
              </div>
              {isOpen && (
                <div className="species-notes">
                  {s.notes ? (
                    renderNotes(s.notes)
                  ) : (
                    <p className="muted">
                      No guidebook notes recorded for {name}.
                    </p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
