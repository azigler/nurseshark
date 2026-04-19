// Species pill. Renders the species head portrait (cropped south-facing
// frame from parts.rsi, emitted by src/gen/build-spritesheet.ts) alongside
// the fluent-resolved name. Falls back to a "●" dot when the manifest entry
// is missing — this covers both the "sprite pipeline hasn't run yet" and
// "unmapped species" cases so the UI never breaks.

import { Link } from 'react-router-dom';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { speciesSpriteUrl } from '../data/sprite-url';
import { useData } from '../data/store';

export function SpeciesBadge({
  speciesId,
  link,
}: {
  speciesId: string;
  link?: boolean;
}) {
  const data = useData();
  const sp = data.speciesById.get(speciesId);
  const label = sp?.nameKey
    ? resolveFluentKey(data.fluent, sp.nameKey)
    : prettifyId(speciesId);
  const spriteUrl = speciesSpriteUrl(data.sprites, speciesId);

  const style = {
    background: '#1b3958',
    color: '#dcefff',
    padding: '0.2em 0.6em',
    borderRadius: '0.25em',
    fontSize: '0.85em',
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4em',
    textDecoration: 'none',
  } as const;

  const icon = spriteUrl ? (
    <img
      className="species-badge-sprite"
      src={spriteUrl}
      width={16}
      height={16}
      alt=""
      aria-hidden="true"
      style={{ imageRendering: 'pixelated', verticalAlign: 'middle' }}
    />
  ) : (
    <span aria-hidden="true">●</span>
  );

  const body = (
    <>
      {icon}
      <span>{label}</span>
    </>
  );

  if (link && sp) {
    return (
      <Link to={`/species#${speciesId}`} style={style}>
        {body}
      </Link>
    );
  }
  return <span style={style}>{body}</span>;
}
