// Compact card for a single reagent — sprite, name, small color swatch,
// group (if any), and "heals" summary. Used in the /reagents grid and in
// various cross-reference lists.

import { Link } from 'react-router-dom';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { blacklistEntry } from '../data/reagent-blacklist';
import { useData } from '../data/store';
import type { Reagent } from '../types';
import { ReagentSprite } from './ReagentSprite';

export function ReagentCard({
  reagent,
  compact,
  showBlacklistBadge,
}: {
  reagent: Reagent;
  compact?: boolean;
  /**
   * When true, renders a restriction badge if this reagent is in the
   * blacklist. Typically set on the /reagents grid when the "Show admin /
   * rare reagents" toggle is on; left off elsewhere (cross-reference lists,
   * reaction products) since those contexts already have their own semantic.
   */
  showBlacklistBadge?: boolean;
}) {
  const data = useData();
  const displayName =
    resolveFluentKey(data.fluent, reagent.name) || prettifyId(reagent.id);
  const desc = reagent.desc
    ? resolveFluentKey(data.fluent, reagent.desc)
    : null;
  const restriction = showBlacklistBadge ? blacklistEntry(reagent.id) : null;

  // Fold group heal targets into type counts for a compact summary.
  const typeTargets = new Set<string>();
  for (const h of reagent.heals) {
    if (h.kind === 'type') {
      typeTargets.add(h.target);
    } else {
      const members = data.damageGroupMembers.get(h.target);
      if (members) {
        for (const m of members) {
          typeTargets.add(m);
        }
      }
    }
  }

  return (
    <Link to={`/reagents/${reagent.id}`} className="reagent-card">
      <div className="reagent-card-head">
        <ReagentSprite reagentId={reagent.id} size={compact ? 24 : 40} />
        <div className="reagent-card-title">
          <div className="reagent-card-name">{displayName}</div>
          {!compact && reagent.group && (
            <div className="reagent-card-group">{reagent.group}</div>
          )}
        </div>
      </div>
      {!compact && restriction && (
        <div
          className={`reagent-card-badge reagent-card-badge-${restriction.reason}`}
          title={restriction.notes}
        >
          {restriction.reason}
        </div>
      )}
      {!compact && desc && (
        <div className="reagent-card-desc" title={desc}>
          {desc.length > 160 ? `${desc.slice(0, 160)}…` : desc}
        </div>
      )}
      {!compact && typeTargets.size > 0 && (
        <div className="reagent-card-heals">
          <span className="reagent-card-heals-label">heals:</span>{' '}
          {[...typeTargets].sort().join(', ')}
        </div>
      )}
      {!compact && reagent.conflictsWith.length > 0 && (
        <div className="reagent-card-warn">
          ⚠ conflicts w/ {reagent.conflictsWith.length} reagent(s)
        </div>
      )}
    </Link>
  );
}
