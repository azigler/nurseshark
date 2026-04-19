// Vitest setup. Registers jest-dom matchers so tests can use
// `toBeInTheDocument()` etc., and stubs fetch to return the on-disk JSON
// bundles from public/data so components that load data at mount don't
// blow up with "fetch is not defined."
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dataRoot = resolve(__dirname, '../../public/data');

function loadJson(relPath: string): unknown {
  return JSON.parse(readFileSync(resolve(dataRoot, relPath), 'utf8'));
}

// Map URL paths (relative to import.meta.env.BASE_URL) to the local JSON
// bundle they resolve to. Tests run with BASE_URL = '/' by default.
const fixtures: Record<string, () => unknown> = {
  '/data/reagents.json': () => loadJson('reagents.json'),
  '/data/reactions.json': () => loadJson('reactions.json'),
  '/data/damage.json': () => loadJson('damage.json'),
  '/data/species.json': () => loadJson('species.json'),
  '/data/containers.json': () => loadJson('containers.json'),
  '/data/physical-items.json': () => loadJson('physical-items.json'),
  '/data/fluent.json': () => loadJson('fluent.json'),
  '/data/meta.json': () => loadJson('meta.json'),
  '/data/sprites_manifest.json': () => loadJson('sprites_manifest.json'),
};

globalThis.fetch = ((input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input.toString();
  // Normalize: strip leading origin, strip base prefix if present.
  const pathOnly = url.replace(/^https?:\/\/[^/]+/, '');
  const key = Object.keys(fixtures).find((k) => pathOnly.endsWith(k));
  if (!key) {
    return Promise.reject(new Error(`test fetch: no fixture for ${url}`));
  }
  const body = fixtures[key]();
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}) as typeof fetch;

// clipboard stub for CopyLabelButton tests.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.resolve() },
    configurable: true,
  });
}
