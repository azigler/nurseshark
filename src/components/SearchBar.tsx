// Fuzzy search across reagents + reactions + species + damage types. Renders
// a text input plus a dropdown of ranked results. Used both as the nav's
// global search and (wrapped) as the solver's target field.
//
// Matching: simple case-insensitive contains on the resolved display name +
// the raw ID, with a small bonus for prefix matches. No fancy fuzzy algos —
// the domain dictionary is ~450 names and contains-match feels fine.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { useData } from '../data/store';

export interface SearchHit {
  readonly kind: 'reagent' | 'reaction' | 'species' | 'damage';
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly score: number;
}

export interface SearchBarProps {
  /** Placeholder text. */
  readonly placeholder?: string;
  /** When set, fires on select instead of navigating. Used by solver form. */
  readonly onSelect?: (hit: SearchHit) => void;
  /** Constrain search to a single result kind (solver field uses "reagent"). */
  readonly onlyKind?: SearchHit['kind'];
  /** Extra class for styling. */
  readonly className?: string;
}

export function SearchBar({
  placeholder = 'Search reagents, reactions, damage, species…',
  onSelect,
  onlyKind,
  className,
}: SearchBarProps) {
  const data = useData();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Build the corpus once.
  const corpus = useMemo(() => {
    const hits: SearchHit[] = [];
    if (!onlyKind || onlyKind === 'reagent') {
      for (const r of data.reagents) {
        const label = resolveFluentKey(data.fluent, r.name) || prettifyId(r.id);
        hits.push({
          kind: 'reagent',
          id: r.id,
          label,
          href: `/reagents/${r.id}`,
          score: 0,
        });
      }
    }
    if (!onlyKind || onlyKind === 'reaction') {
      for (const rx of data.reactions) {
        hits.push({
          kind: 'reaction',
          id: rx.id,
          label: rx.id,
          href: `/reactions#${rx.id}`,
          score: 0,
        });
      }
    }
    if (!onlyKind || onlyKind === 'damage') {
      for (const d of data.damage) {
        const label = d.nameKey
          ? resolveFluentKey(data.fluent, d.nameKey)
          : prettifyId(d.id);
        hits.push({
          kind: 'damage',
          id: d.id,
          label,
          href: `/damage/${d.id}`,
          score: 0,
        });
      }
    }
    if (!onlyKind || onlyKind === 'species') {
      for (const s of data.species) {
        const label = s.nameKey
          ? resolveFluentKey(data.fluent, s.nameKey)
          : prettifyId(s.id);
        hits.push({
          kind: 'species',
          id: s.id,
          label,
          href: `/species#${s.id}`,
          score: 0,
        });
      }
    }
    return hits;
  }, [data, onlyKind]);

  const results = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    const scored = corpus
      .map((h) => {
        const label = h.label.toLowerCase();
        const id = h.id.toLowerCase();
        let score = 0;
        if (label === q || id === q) {
          score = 1000;
        } else if (label.startsWith(q) || id.startsWith(q)) {
          score = 500;
        } else if (label.includes(q) || id.includes(q)) {
          score = 100 - (label.indexOf(q) >= 0 ? label.indexOf(q) : 50);
        }
        return { ...h, score };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, 20);
    return scored;
  }, [corpus, query]);

  useEffect(() => {
    setHighlight(0);
  }, []);

  // Global escape listener to clear / close.
  useEffect(() => {
    const onEsc = () => {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    };
    window.addEventListener('nurseshark:escape', onEsc);
    return () => window.removeEventListener('nurseshark:escape', onEsc);
  }, []);

  const pick = (hit: SearchHit) => {
    setOpen(false);
    setQuery('');
    if (onSelect) {
      onSelect(hit);
    } else {
      navigate(hit.href);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (results[highlight]) {
        e.preventDefault();
        pick(results[highlight]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  };

  return (
    <div className={`search-bar ${className ?? ''}`}>
      <input
        ref={inputRef}
        data-search-input
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="search-results"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Defer close so clicks on results still register.
          window.setTimeout(() => setOpen(false), 120);
        }}
      />
      {open && results.length > 0 && (
        <div id="search-results" className="search-results" role="listbox">
          {results.map((hit, idx) => (
            <div
              key={`${hit.kind}:${hit.id}`}
              role="option"
              tabIndex={-1}
              aria-selected={idx === highlight}
              className={`search-result ${idx === highlight ? 'hl' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(hit);
              }}
              onMouseEnter={() => setHighlight(idx)}
            >
              <span className={`kind kind-${hit.kind}`}>{hit.kind}</span>
              <span className="label">{hit.label}</span>
              {hit.id !== hit.label && (
                <span className="id">
                  <code>{hit.id}</code>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
