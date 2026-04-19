// Parses SS14 Fluent `.ftl` locale files into a flat key -> string lookup
// that the frontend can use to resolve `reagent-name-foo`, `damage-type-blunt`,
// `damage-group-brute`, `species-name-vox`, etc. at runtime.
//
// Why build-time, not runtime client-side: the Fluent files total ~a few MB
// for the subset we want. Folding them into a single ~50 KB JSON at build
// time saves ~20 HTTP requests + ~1 MB gzip on first paint.
//
// We only pull simple `key = value` pairs from the files we know are safe
// (messages, not terms or attributes). If a file uses `{ $placeable }`
// tokens or multi-line select expressions, we keep the raw text — the
// frontend is not a full Fluent runtime. In practice the reagent / damage /
// species name messages are single-line plain text.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface FluentDict {
  readonly [key: string]: string;
}

function walkFtl(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walkFtl(full, out);
    } else if (s.isFile() && name.endsWith('.ftl')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Parse a single .ftl file into a partial dictionary. Only matches top-level
 * `key = value` messages; skips terms (`-key = value`), attributes
 * (`.attr = value`), and any messages with placeables.
 */
function parseFtlFile(path: string): FluentDict {
  const src = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const out: Record<string, string> = {};

  // Fluent messages can span multiple lines — subsequent indented lines
  // continue the previous message. We do a conservative line-by-line pass
  // and accept only single-line messages for simplicity.
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments and blank lines.
    if (!line || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    // Match `key = value` at column 0 (no leading whitespace). Keys allow
    // ASCII letters, digits, hyphen, underscore.
    const m = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      continue;
    }
    const [, key, rawValue] = m;
    const value = rawValue.trim();
    // Skip empty values (those probably continue on subsequent lines).
    if (!value) {
      continue;
    }
    // Skip messages with Fluent placeables or select expressions — we can't
    // resolve them without a real runtime.
    if (value.includes('{') || value.includes('}')) {
      continue;
    }
    out[key] = value;
  }

  return out;
}

/**
 * Walk all .ftl files under the given locale subdirectories and merge them.
 * Later files win on conflict (last-definition semantics).
 */
export function resolveFluent(vs14Path: string): FluentDict {
  const locale = resolve(vs14Path, 'Resources/Locale/en-US');
  const subdirs = ['reagents', 'damage', 'species', 'chemistry'];
  const dict: Record<string, string> = {};

  for (const sub of subdirs) {
    const root = resolve(locale, sub);
    const files = walkFtl(root);
    for (const f of files) {
      const partial = parseFtlFile(f);
      Object.assign(dict, partial);
    }
  }

  // Prune to only the message prefixes the frontend actually uses — this
  // keeps the JSON small. The exact list matches the keys we emit from the
  // resolvers (`reagent-name-*`, `reagent-desc-*`, `reagent-physical-desc-*`,
  // `damage-type-*`, `damage-group-*`, `species-name-*`).
  const prefixes = [
    'reagent-name-',
    'reagent-desc-',
    'reagent-physical-desc-',
    'damage-type-',
    'damage-group-',
    'species-name-',
  ];
  const pruned: Record<string, string> = {};
  for (const [k, v] of Object.entries(dict)) {
    if (prefixes.some((p) => k.startsWith(p))) {
      pruned[k] = v;
    }
  }

  return pruned;
}
