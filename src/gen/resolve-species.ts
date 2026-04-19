// Walks Species/ and folds in the human-written Guidebook/Mobs/<Id>.xml
// notes so the frontend can show species biology without parsing XML.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findYamlFiles, readPrototypes } from './read-yaml';
import { cleanGuidebookText } from './resolve-damage';
import type { OutSpecies, RawSpeciesPrototype } from './types';

// Species whose Guidebook file is named differently than the species ID
// (SlimePerson.xml rather than Slime.xml, etc.).
const GUIDEBOOK_ALIASES: Record<string, string> = {
  Slime: 'SlimePerson',
};

function readGuidebookNotes(
  vs14Path: string,
  speciesId: string,
): string | null {
  const mobsDir = join(vs14Path, 'Resources/ServerInfo/Guidebook/Mobs');
  const candidates = [GUIDEBOOK_ALIASES[speciesId] ?? speciesId, speciesId];
  for (const candidate of candidates) {
    const xmlPath = join(mobsDir, `${candidate}.xml`);
    if (existsSync(xmlPath)) {
      const raw = readFileSync(xmlPath, 'utf8').replace(/^\uFEFF/, '');
      const cleaned = cleanGuidebookText(raw);
      return cleaned.length > 0 ? cleaned : null;
    }
  }
  return null;
}

export function resolveSpecies(vs14Path: string): readonly OutSpecies[] {
  const dir = join(vs14Path, 'Resources/Prototypes/Species');
  const files = findYamlFiles(dir);
  const raw = readPrototypes(files, [
    'species',
  ]) as unknown as RawSpeciesPrototype[];

  const out: OutSpecies[] = [];
  for (const s of raw) {
    if (!s.id) continue;
    out.push({
      id: s.id,
      nameKey: s.name ?? null,
      prototype: s.prototype ?? null,
      notes: readGuidebookNotes(vs14Path, s.id),
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
