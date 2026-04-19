// Writes final JSON artifacts into `public/data/`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeJson(outDir: string, name: string, data: unknown): void {
  mkdirSync(outDir, { recursive: true });
  const full = join(outDir, `${name}.json`);
  writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`);
}
