// Species pill. Has no icons yet (we don't sprite-extract them in vs-ykc)
// — uses a small "●" + fluent-resolved name.

import { Link } from 'react-router-dom';
import { prettifyId, resolveFluentKey } from '../data/fluent';
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

  const style = {
    background: '#1b3958',
    color: '#dcefff',
    padding: '0.2em 0.6em',
    borderRadius: '0.25em',
    fontSize: '0.85em',
    fontWeight: 500,
    display: 'inline-block',
    textDecoration: 'none',
  } as const;

  const body = (
    <>
      <span aria-hidden="true" style={{ marginRight: '0.4em' }}>
        ●
      </span>
      {label}
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
