// Color-coded damage-type or damage-group pill. Can optionally link to the
// /damage/:type page; defaults to plain span to let callers compose.

import { Link } from 'react-router-dom';
import { paletteFor } from '../data/damage-color';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { useData } from '../data/store';

export interface DamageBadgeProps {
  /** A damage type id (Blunt, Heat, ...) OR a damage group id (Brute, Burn, ...). */
  readonly type: string;
  readonly linkToPage?: boolean;
  readonly small?: boolean;
}

export function DamageBadge({ type, linkToPage, small }: DamageBadgeProps) {
  const data = useData();
  const palette = paletteFor(type);
  // Prefer Fluent-resolved name if we have it.
  const dt = data.damageById.get(type);
  const label = dt?.nameKey
    ? resolveFluentKey(data.fluent, dt.nameKey)
    : resolveFluentKey(data.fluent, `damage-group-${type.toLowerCase()}`) !==
        `damage-group-${type.toLowerCase()}`
      ? resolveFluentKey(data.fluent, `damage-group-${type.toLowerCase()}`)
      : prettifyId(type);

  const style = {
    background: palette.bg,
    color: palette.fg,
    padding: small ? '0.1em 0.4em' : '0.2em 0.55em',
    borderRadius: '0.25em',
    fontSize: small ? '0.75em' : '0.85em',
    fontWeight: 600,
    letterSpacing: '0.02em',
    display: 'inline-block',
    textDecoration: 'none',
  } as const;

  if (linkToPage && data.damageById.has(type)) {
    return (
      <Link to={`/damage/${type}`} style={style}>
        {label}
      </Link>
    );
  }
  return <span style={style}>{label}</span>;
}
