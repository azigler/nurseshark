// Light parser for `src/data/pro-tips.md`. Extracts frontmatter, splits by
// `##` / `###` headings, and annotates each bullet with its `[verified]` /
// `[unverified]` / `[new]` tag (if present). We avoid pulling in a full
// AST/remark library — the file is hand-written and the structure is
// predictable.

export type ProTipTag = 'verified' | 'unverified' | 'new' | null;

export interface ProTipBullet {
  readonly tag: ProTipTag;
  /** Markdown-formatted body of the bullet (inline formatting preserved). */
  readonly body: string;
  /** Nested bullets (2-space or greater indent). */
  readonly children: readonly ProTipBullet[];
}

export interface ProTipSubsection {
  readonly heading: string;
  readonly bullets: readonly ProTipBullet[];
  /** Intro paragraph text between the heading and the first bullet. */
  readonly intro: string | null;
}

export interface ProTipSection {
  readonly heading: string;
  readonly intro: string | null;
  readonly subsections: readonly ProTipSubsection[];
  readonly bullets: readonly ProTipBullet[];
}

export interface ProTipsDocument {
  readonly frontmatter: Readonly<Record<string, string>>;
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly ProTipSection[];
}

/** Parse the YAML frontmatter at the top of the file (plain key: value). */
function parseFrontmatter(src: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (!src.startsWith('---')) {
    return { frontmatter: {}, body: src };
  }
  const end = src.indexOf('\n---', 3);
  if (end < 0) {
    return { frontmatter: {}, body: src };
  }
  const header = src.slice(3, end).trim();
  const body = src.slice(end + 4).replace(/^\n/, '');
  const frontmatter: Record<string, string> = {};
  for (const line of header.split('\n')) {
    const m = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (m) {
      frontmatter[m[1]] = m[2].trim();
    }
  }
  return { frontmatter, body };
}

/** Pull a leading `[tag]` off a bullet body; return the rest + the tag.
 * Handles three forms:
 *   `[verified] ...`
 *   `**[verified]** ...`
 *   `**[verified] rest of the bold**` (tag is inside the ** span — our
 *   most common form in pro-tips.md).
 */
function extractTag(body: string): { tag: ProTipTag; rest: string } {
  const mInside = /^\*\*\[(verified|unverified|new)\]\s+/.exec(body);
  if (mInside) {
    const tag = mInside[1] as ProTipTag;
    // Re-open the bold span after stripping the tag.
    const rest = `**${body.slice(mInside[0].length)}`;
    return { tag, rest };
  }
  const m = /^\*\*\[(verified|unverified|new)\]\*\*\s+/.exec(body);
  if (m) {
    return {
      tag: m[1] as ProTipTag,
      rest: body.slice(m[0].length),
    };
  }
  const m2 = /^\[(verified|unverified|new)\]\s+/.exec(body);
  if (m2) {
    return {
      tag: m2[1] as ProTipTag,
      rest: body.slice(m2[0].length),
    };
  }
  return { tag: null, rest: body };
}

interface BulletLine {
  indent: number;
  text: string;
}

/** Turn consecutive `- ...` lines into a tree by indent. */
function collectBullets(
  lines: readonly string[],
  startIdx: number,
): { bullets: ProTipBullet[]; nextIdx: number } {
  const raw: BulletLine[] = [];
  let i = startIdx;
  let currentText = '';
  let currentIndent = -1;

  const flush = () => {
    if (currentText) {
      raw.push({ indent: currentIndent, text: currentText });
      currentText = '';
      currentIndent = -1;
    }
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = /^(\s*)-\s+(.*)$/.exec(line);
    if (bulletMatch) {
      flush();
      currentIndent = bulletMatch[1].length;
      currentText = bulletMatch[2];
      continue;
    }
    // Continuation of a bullet (indented text, non-empty).
    if (currentIndent >= 0 && /^\s+\S/.test(line) && !line.startsWith('#')) {
      currentText += ` ${line.trim()}`;
      continue;
    }
    // Blank line in the middle of bullets is OK, keep going if next line is
    // also a bullet. Otherwise break.
    if (line.trim() === '' && i + 1 < lines.length) {
      const next = lines[i + 1];
      if (/^(\s*)-\s+/.test(next)) {
        flush();
        continue;
      }
    }
    break;
  }
  flush();

  // Turn the indent-tagged list into a tree. Each time indent increases, we
  // nest; when it decreases back, we pop.
  const roots: ProTipBullet[] = [];
  // Stack entries are { indent, children } — pointers into trees we're
  // currently filling.
  const stack: { indent: number; children: ProTipBullet[] }[] = [
    { indent: -1, children: roots },
  ];

  for (const b of raw) {
    while (stack.length > 1 && b.indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const { tag, rest } = extractTag(b.text);
    const node: ProTipBullet = { tag, body: rest, children: [] };
    stack[stack.length - 1].children.push(node);
    // Because `children` on ProTipBullet is readonly, we push into the
    // non-readonly underlying array via an unsafe cast — we're still in the
    // builder.
    stack.push({
      indent: b.indent,
      children: node.children as ProTipBullet[],
    });
  }

  return { bullets: roots, nextIdx: i };
}

export function parseProTips(src: string): ProTipsDocument {
  const { frontmatter, body } = parseFrontmatter(src);
  const lines = body.split('\n');

  let title = frontmatter.title ?? 'Pro Tips';
  const sections: ProTipSection[] = [];
  const introBuf: string[] = [];
  let haveTopH1 = false;

  let currentSection: {
    heading: string;
    intro: string[];
    subsections: ProTipSubsection[];
    bullets: ProTipBullet[];
  } | null = null;

  let currentSubsection: {
    heading: string;
    bullets: ProTipBullet[];
    intro: string[];
  } | null = null;

  let pendingParaLines: string[] = [];

  const flushPara = () => {
    if (pendingParaLines.length === 0) {
      return;
    }
    const para = pendingParaLines.join(' ').trim();
    pendingParaLines = [];
    if (!para) {
      return;
    }
    if (currentSubsection) {
      currentSubsection.intro.push(para);
    } else if (currentSection) {
      currentSection.intro.push(para);
    } else {
      introBuf.push(para);
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // H1 - page title.
    const mH1 = /^#\s+(.*)$/.exec(line);
    if (mH1) {
      flushPara();
      if (!haveTopH1) {
        title = mH1[1].trim();
        haveTopH1 = true;
      }
      i++;
      continue;
    }
    // H2 - section.
    const mH2 = /^##\s+(.*)$/.exec(line);
    if (mH2) {
      flushPara();
      if (currentSubsection && currentSection) {
        currentSection.subsections.push({
          heading: currentSubsection.heading,
          bullets: currentSubsection.bullets,
          intro: currentSubsection.intro.join(' ').trim() || null,
        });
        currentSubsection = null;
      }
      if (currentSection) {
        sections.push({
          heading: currentSection.heading,
          bullets: currentSection.bullets,
          subsections: currentSection.subsections,
          intro: currentSection.intro.join(' ').trim() || null,
        });
      }
      currentSection = {
        heading: mH2[1].trim(),
        intro: [],
        subsections: [],
        bullets: [],
      };
      i++;
      continue;
    }
    // H3 - subsection (only meaningful under a section).
    const mH3 = /^###\s+(.*)$/.exec(line);
    if (mH3 && currentSection) {
      flushPara();
      if (currentSubsection) {
        currentSection.subsections.push({
          heading: currentSubsection.heading,
          bullets: currentSubsection.bullets,
          intro: currentSubsection.intro.join(' ').trim() || null,
        });
      }
      currentSubsection = {
        heading: mH3[1].trim(),
        bullets: [],
        intro: [],
      };
      i++;
      continue;
    }
    // Horizontal rule / `---` — separates sections structurally; no-op.
    if (/^---\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }
    // Bullet — collect as tree, attach to current (sub)section.
    if (/^\s*-\s+/.test(line)) {
      flushPara();
      const { bullets, nextIdx } = collectBullets(lines, i);
      if (currentSubsection) {
        currentSubsection.bullets.push(...bullets);
      } else if (currentSection) {
        currentSection.bullets.push(...bullets);
      }
      // Not attaching to intro — bullets before any section are rare.
      i = nextIdx;
      continue;
    }
    // Accumulate paragraph text.
    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }
    pendingParaLines.push(line.trim());
    i++;
  }

  flushPara();
  if (currentSubsection && currentSection) {
    currentSection.subsections.push({
      heading: currentSubsection.heading,
      bullets: currentSubsection.bullets,
      intro: currentSubsection.intro.join(' ').trim() || null,
    });
  }
  if (currentSection) {
    sections.push({
      heading: currentSection.heading,
      bullets: currentSection.bullets,
      subsections: currentSection.subsections,
      intro: currentSection.intro.join(' ').trim() || null,
    });
  }

  return {
    frontmatter,
    title,
    intro: introBuf.join('\n\n').trim(),
    sections,
  };
}

/** All unique tags across every bullet (recursive). */
export function collectTags(doc: ProTipsDocument): Set<ProTipTag> {
  const out = new Set<ProTipTag>();
  const walk = (bs: readonly ProTipBullet[]) => {
    for (const b of bs) {
      out.add(b.tag);
      walk(b.children);
    }
  };
  for (const s of doc.sections) {
    walk(s.bullets);
    for (const sub of s.subsections) {
      walk(sub.bullets);
    }
  }
  return out;
}
