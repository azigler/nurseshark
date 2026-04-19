// /pro-tips — renders src/data/pro-tips.md with tag filters.

import { useMemo, useState } from 'react';
import {
  bulletMatchesFilter,
  ProTipCallout,
} from '../components/ProTipCallout';
import { MarkdownInline } from '../data/markdown-inline';
import proTipsSource from '../data/pro-tips.md?raw';
import {
  collectTags,
  type ProTipTag,
  parseProTips,
} from '../data/pro-tips-parser';

const TAG_LABELS: Record<string, string> = {
  verified: 'Verified',
  unverified: 'Unverified',
  new: 'New',
  none: 'Untagged',
};

function tagKey(t: ProTipTag): string {
  return t ?? 'none';
}

export function ProTipsPage() {
  const doc = useMemo(() => parseProTips(proTipsSource), []);
  const availableTags = useMemo(() => collectTags(doc), [doc]);

  const [enabled, setEnabled] = useState<Set<ProTipTag>>(() => {
    // Default: show everything.
    return new Set(availableTags);
  });

  const toggle = (t: ProTipTag) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        next.delete(t);
      } else {
        next.add(t);
      }
      return next;
    });
  };

  return (
    <div className="pro-tips-page">
      <header className="page-head">
        <h1>{doc.title}</h1>
        {doc.intro && (
          <p className="tagline">
            <MarkdownInline text={doc.intro} />
          </p>
        )}
        {Object.keys(doc.frontmatter).length > 0 && (
          <div className="frontmatter-meta">
            {Object.entries(doc.frontmatter).map(([k, v]) => (
              <span key={k}>
                <strong>{k}</strong>: {v}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="tag-filter">
        <span className="tag-filter-label">Show:</span>
        {[...availableTags].map((t) => {
          const key = tagKey(t);
          const isOn = enabled.has(t);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(t)}
              className={`tag-chip tag-chip-${key} ${isOn ? 'on' : 'off'}`}
              aria-pressed={isOn}
            >
              [{TAG_LABELS[key] ?? key}]
            </button>
          );
        })}
      </div>

      {doc.sections.map((section) => {
        const filteredBullets = section.bullets.filter((b) =>
          bulletMatchesFilter(b, enabled),
        );
        const filteredSubs = section.subsections
          .map((sub) => ({
            ...sub,
            bullets: sub.bullets.filter((b) => bulletMatchesFilter(b, enabled)),
          }))
          .filter((sub) => sub.bullets.length > 0);

        if (filteredBullets.length === 0 && filteredSubs.length === 0) {
          return null;
        }

        return (
          <section key={section.heading} className="protip-section">
            <h2>{section.heading}</h2>
            {section.intro && (
              <p>
                <MarkdownInline text={section.intro} />
              </p>
            )}
            {filteredBullets.map((b, idx) => (
              <ProTipCallout key={`b-${idx}`} bullet={b} />
            ))}
            {filteredSubs.map((sub) => (
              <div key={sub.heading} className="protip-subsection">
                <h3>{sub.heading}</h3>
                {sub.intro && (
                  <p>
                    <MarkdownInline text={sub.intro} />
                  </p>
                )}
                {sub.bullets.map((b, idx) => (
                  <ProTipCallout key={`sb-${idx}`} bullet={b} />
                ))}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
