// Walks the Damage/ prototype folder and constructs the damage.json record.
// Cross-references reagents (via their `heals` list) to flag which types
// are `treatable`. `Holy` is force-flagged non-treatable per the spec.
import { join } from 'node:path';
import { findYamlFiles, readPrototypes } from './read-yaml';
import type {
  OutDamageType,
  OutReagent,
  RawDamageGroupPrototype,
  RawDamageModifierSetPrototype,
  RawDamageTypePrototype,
} from './types';

const NEVER_TREATABLE_IDS = new Set(['Holy']);

export interface ResolveDamageResult {
  readonly damageTypes: readonly OutDamageType[];
  readonly damageGroups: ReadonlyMap<string, readonly string[]>;
  readonly damageModifierSets: ReadonlyArray<RawDamageModifierSetPrototype>;
}

export function resolveDamage(
  vs14Path: string,
  reagents: readonly OutReagent[],
): ResolveDamageResult {
  const damageDir = join(vs14Path, 'Resources/Prototypes/Damage');
  const files = findYamlFiles(damageDir);
  const raw = readPrototypes(files, [
    'damageType',
    'damageGroup',
    'damageModifierSet',
  ]);

  const types: RawDamageTypePrototype[] = [];
  const groups: RawDamageGroupPrototype[] = [];
  const modifierSets: RawDamageModifierSetPrototype[] = [];
  for (const p of raw) {
    if (p.type === 'damageType')
      types.push(p as unknown as RawDamageTypePrototype);
    else if (p.type === 'damageGroup')
      groups.push(p as unknown as RawDamageGroupPrototype);
    else if (p.type === 'damageModifierSet')
      modifierSets.push(p as unknown as RawDamageModifierSetPrototype);
  }

  // Build an index: for each damage-type ID, which reagents heal it?
  const reagentsByType = new Map<string, Set<string>>();
  // Map each damage GROUP -> set of damage TYPE IDs it contains.
  const typesByGroup = new Map<string, readonly string[]>();
  for (const g of groups) {
    if (g.id && Array.isArray(g.damageTypes)) {
      typesByGroup.set(g.id, g.damageTypes);
    }
  }

  for (const r of reagents) {
    for (const h of r.heals) {
      if (h.kind === 'type') {
        let s = reagentsByType.get(h.target);
        if (!s) {
          s = new Set();
          reagentsByType.set(h.target, s);
        }
        s.add(r.id);
      } else {
        // Expand group to member types.
        const members = typesByGroup.get(h.target) ?? [];
        for (const t of members) {
          let s = reagentsByType.get(t);
          if (!s) {
            s = new Set();
            reagentsByType.set(t, s);
          }
          s.add(r.id);
        }
      }
    }
  }

  // Map damage type ID -> its group ID (first matching group).
  const groupByType = new Map<string, string>();
  for (const g of groups) {
    for (const t of g.damageTypes ?? []) {
      if (!groupByType.has(t)) groupByType.set(t, g.id);
    }
  }

  const damageTypes: OutDamageType[] = types.map((t) => {
    const healers = reagentsByType.get(t.id);
    const treatable =
      !NEVER_TREATABLE_IDS.has(t.id) && !!healers && healers.size > 0;
    return {
      id: t.id,
      nameKey: t.name ?? null,
      group: groupByType.get(t.id) ?? null,
      treatable,
      reagentsThatHeal: healers ? Array.from(healers).sort() : [],
    };
  });

  damageTypes.sort((a, b) => a.id.localeCompare(b.id));
  return {
    damageTypes,
    damageGroups: typesByGroup,
    damageModifierSets: modifierSets,
  };
}

/**
 * Strip basic BBCode-ish tags from SS14 guidebook XML text content and
 * collapse whitespace. Exposed so tests can drive it directly.
 */
export function cleanGuidebookText(xml: string): string {
  // Drop anything that looks like an XML tag name on a single line
  // (<Document>, <Box>, <GuideEntityEmbed .../>, </Document>, etc.)
  let out = xml.replace(/<\/?[A-Z][\w-]*(?:\s[^>]*)?\/?\s*>/g, ' ');
  // BBCode color tags: [color=#abc] ... [/color] -> just strip the tags.
  out = out.replace(/\[\/?[A-Za-z][A-Za-z0-9=#,\s\-_.]*\]/g, ' ');
  // Entities.
  out = out.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  // Normalize whitespace: collapse runs of spaces/tabs, strip trailing
  // whitespace on lines, collapse runs of 3+ newlines to a paragraph break,
  // but preserve single paragraph breaks (`\n\n`).
  out = out.replace(/[ \t]+/g, ' ');
  out = out.replace(/ *\n */g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}
