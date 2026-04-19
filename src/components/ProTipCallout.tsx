// Colored callout per tag. Renders inline-markdown body and recursively its
// children (nested bullets). Used by /pro-tips and inline references on
// section pages.

import { MarkdownInline } from '../data/markdown-inline';
import type { ProTipBullet, ProTipTag } from '../data/pro-tips-parser';

const TAG_STYLE: Record<string, { bg: string; border: string; fg: string }> = {
  verified: { bg: '#1a3a22', border: '#4a8e3a', fg: '#d5f0c8' },
  unverified: { bg: '#3a3418', border: '#b59840', fg: '#f4e4b5' },
  new: { bg: '#1a2c3a', border: '#4a8ab5', fg: '#c8e2f4' },
  none: { bg: '#232a34', border: '#44556a', fg: '#e7eef6' },
};

export function ProTipCallout({ bullet }: { bullet: ProTipBullet }) {
  const style = TAG_STYLE[bullet.tag ?? 'none'];
  return (
    <div
      className={`pro-tip pro-tip-${bullet.tag ?? 'none'}`}
      style={{
        background: style.bg,
        borderLeft: `3px solid ${style.border}`,
        color: style.fg,
      }}
    >
      <div className="pro-tip-head">
        {bullet.tag && <span className="pro-tip-tag">[{bullet.tag}]</span>}
      </div>
      <div className="pro-tip-body">
        <MarkdownInline text={bullet.body} />
      </div>
      {bullet.children.length > 0 && (
        <div className="pro-tip-children">
          {bullet.children.map((c, idx) => (
            <ProTipCallout key={`child-${idx}`} bullet={c} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Returns true if the tag is in the set of enabled tags. Treats null as "none". */
export function bulletMatchesFilter(
  bullet: ProTipBullet,
  enabled: Set<ProTipTag>,
): boolean {
  if (enabled.has(bullet.tag)) {
    return true;
  }
  return bullet.children.some((c) => bulletMatchesFilter(c, enabled));
}
