// Walks a directory recursively and parses every *.yml file into the raw
// SS14 prototype shapes (flat array of { type, id, ... } objects, stripped of
// the custom `!type:X` tag semantics into an `__type` key on the object).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_SCHEMA,
  load as parseYaml,
  type Schema,
  Type as YamlType,
} from 'js-yaml';

// SS14 uses `!type:CreateEntityReactionEffect`-style tags liberally on
// polymorphic objects (health effects, status effects, conditions, etc.).
// `js-yaml` needs each tag declared explicitly. We use a permissive catch-all:
// every `!type:X` tag is mapped to `{ __type: 'X', ...rest }` regardless of X.
//
// Trick: js-yaml allows wildcard unknown-tag handling via `onUnknownTag`? It
// doesn't directly — but we can enumerate a small set of known tags and fall
// back to loading files with an `onWarning` handler that silently accepts.
//
// Simpler path: enumerate the tags we care about. Anything we don't enumerate
// stays a string through the unknown-tag fallback (js-yaml will fail on
// unknown tags by default, so we register a generic multi-tag shortcut below).

const tagNames = [
  // Reaction effects
  'CreateEntityReactionEffect',
  'SpawnEntity',
  'Explosion',
  'ExplosionReactionEffect',
  'EmpReactionEffect',
  'AreaReactionEffect',
  'FlashReactionEffect',
  'EmoteReactionEffect',
  // Reagent effects
  'HealthChange',
  'EvenHealthChange',
  'ModifyStatusEffect',
  'AdjustAlert',
  'ResetNarcolepsy',
  'Drunk',
  'Jitter',
  'Jittering',
  'Emote',
  'ChemVomit',
  'Vomit',
  'PopupMessage',
  'ChatMessage',
  'SatiateThirst',
  'SatiateHunger',
  'AdjustReagent',
  'MovespeedModifierMetabolism',
  'Oxygenate',
  'AdjustTemperature',
  'CureDisease',
  'GenericStatusEffect',
  'ChemCleanBloodstream',
  'FlammableReaction',
  'ExtinguishReaction',
  'Ignite',
  'Polymorph',
  'ChemicalsExplosion',
  'ChemHealEyeDamage',
  'ChemActivateBriefcaseLauncher',
  'ChemCauseAnomaly',
  'CreateGas',
  'ModifyBleedAmount',
  'ModifyBloodLevel',
  'PlantAdjustToxins',
  'PlantAdjustHealth',
  'PlantAdjustNutrition',
  'PlantAdjustWater',
  'PlantAdjustWeeds',
  'PlantAdjustPests',
  'PlantAdjustMutationLevel',
  'PlantAdjustMutationMod',
  'PlantDiethylamine',
  'PlantRestoreSeeds',
  'PlantSeedsLoss',
  'PlantPhalanximine',
  'PlantCryoxadone',
  'PlantExude',
  'MakeSentient',
  'WashCreamPieReaction',
  'SetSolutionTemperature',
  'AdjustSolutionTemperature',
  'ReduceRotting',
  'Paralyze',
  'ChemForceFeed',
  'CreatePolymorphedEntity',
  // Conditions
  'ReagentCondition',
  'ReagentThreshold',
  'OrganType',
  'MobStateCondition',
  'HasTag',
  'Hunger',
  'Thirst',
  'Temperature',
  'TotalDamage',
  'SpeciesIs',
  // Food sequence
  'SequenceLength',
  'LastElementHasTags',
  'ElementHasTags',
  'FoodHasReagent',
  'IngredientsWithTags',
];

function makeType(tagName: string): YamlType {
  return new YamlType(`!type:${tagName}`, {
    kind: 'mapping',
    resolve: () => true,
    construct: (data: unknown) => {
      const obj = (data && typeof data === 'object' ? data : {}) as Record<
        string,
        unknown
      >;
      return { __type: tagName, ...obj };
    },
  });
}

const customTypes = tagNames.map(makeType);
const ss14Schema = DEFAULT_SCHEMA.extend(customTypes);

/**
 * Rewrite `!type:X` YAML tags into a `__type: X` key so the default js-yaml
 * schema can parse them. SS14's convention: the tag always decorates a
 * mapping's first line (either after `- ` for a list element, or `key:` for
 * a mapping value). We handle both by replacing the tag with a synthetic
 * `__type: X` key, preserving the original indent.
 *
 * Handled patterns:
 *   "- !type:Foo"           -> "- __type: Foo"
 *   "  - !type:Foo"         -> "  - __type: Foo"
 *   "    !type:Foo"         -> "    __type: Foo"   (child of a mapping key)
 *   "key: !type:Foo"        -> "key:\n<same-indent>  __type: Foo"
 */
export function rewriteSs14TypeTags(src: string): string {
  const lines = src.split(/\n/);
  const out: string[] = [];
  for (const rawLine of lines) {
    // Split off any trailing comment — SS14 YAML often has `!type:Foo # comment`.
    let line = rawLine;
    let trailing = '';
    const cmt = line.match(/^(.*?)(\s+#.*)$/);
    if (cmt) {
      line = cmt[1];
      trailing = cmt[2];
    }
    // `- !type:Foo { }` or `- !type:Foo {}` — flow-form empty mapping (also bare).
    const mFlowList = /^(\s*-\s+)!type:([A-Za-z0-9_]+)(\s*\{\s*\})?\s*$/.exec(
      line,
    );
    if (mFlowList) {
      out.push(`${mFlowList[1]}__type: ${mFlowList[2]}${trailing}`);
      continue;
    }
    // `key: !type:Foo { }` — flow-form as value of a mapping key.
    const mFlowKey =
      /^(\s*)([\w-]+:)\s*!type:([A-Za-z0-9_]+)(\s*\{\s*\})?\s*$/.exec(line);
    if (mFlowKey) {
      out.push(`${mFlowKey[1]}${mFlowKey[2]}${trailing}`);
      out.push(`${mFlowKey[1]}  __type: ${mFlowKey[3]}`);
      continue;
    }
    // `- &anchor !type:Foo` — anchor-then-tag. We drop the anchor since we
    // don't need aliases resolved; the tag becomes a __type key on the map.
    // This breaks *alias references elsewhere, but the referenced data is in
    // a Destructible behavior we don't read anyway.
    const mAnchor = /^(\s*-\s+)&\S+\s+!type:([A-Za-z0-9_]+)\s*$/.exec(line);
    if (mAnchor) {
      out.push(`${mAnchor[1]}__type: ${mAnchor[2]}${trailing}`);
      continue;
    }
    // `  !type:Foo` (mapping key child; continues the current mapping).
    const mBare = /^(\s*)!type:([A-Za-z0-9_]+)(\s*\{\s*\})?\s*$/.exec(line);
    if (mBare) {
      out.push(`${mBare[1]}__type: ${mBare[2]}${trailing}`);
      continue;
    }
    out.push(rawLine);
  }
  // Drop any `- *anchor` lines that now point at nothing (we may have stripped
  // the anchor definition). Leaving them would be a parse error.
  return out.filter((l) => !/^\s*-\s+\*[A-Za-z0-9_]+\s*$/.test(l)).join('\n');
}

/**
 * Parse an SS14 YAML document. We always run the `__type` rewrite first so
 * we don't depend on maintaining a complete tag whitelist. This trades a bit
 * of parse speed for never-dropped fields.
 */
function parseSs14Yaml(source: string, _path: string): unknown {
  const rewritten = rewriteSs14TypeTags(source);
  try {
    return parseYaml(rewritten, { schema: ss14Schema });
  } catch (e) {
    console.warn(`WARN: parse failed for ${_path}: ${(e as Error).message}`);
    return null;
  }
}

function walkDir(dir: string, out: string[] = []): string[] {
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
      walkDir(full, out);
    } else if (s.isFile() && name.endsWith('.yml')) {
      out.push(full);
    }
  }
  return out;
}

/** Recursively find YAML files under `dir`. */
export function findYamlFiles(dir: string): string[] {
  return walkDir(resolve(dir));
}

/**
 * Parse every file under `dir`. Returns an array of top-level prototype
 * objects (each with a `type` and an `id`), filtered to those whose `type`
 * matches one of `relevantTypes` if provided.
 */
export function readPrototypes(
  paths: readonly string[],
  relevantTypes?: readonly string[],
): Record<string, unknown>[] {
  const wanted = relevantTypes ? new Set(relevantTypes) : null;
  const out: Record<string, unknown>[] = [];

  for (const p of paths) {
    const src = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    // Cheap pre-filter: skip files that don't mention any wanted `type:`.
    if (wanted) {
      let any = false;
      for (const t of wanted) {
        if (src.includes(`type: ${t}`)) {
          any = true;
          break;
        }
      }
      if (!any) {
        continue;
      }
    }

    const doc = parseSs14Yaml(src, p);
    if (!Array.isArray(doc)) {
      continue;
    }

    for (const node of doc) {
      if (!node || typeof node !== 'object') {
        continue;
      }
      const obj = node as Record<string, unknown>;
      const t = obj.type;
      if (typeof t !== 'string') {
        continue;
      }
      if (wanted && !wanted.has(t)) {
        continue;
      }
      out.push(obj);
    }
  }

  return out;
}

// Exported only for tests so they can spin up fixtures without hitting disk.
export const __testing = { parseSs14Yaml, ss14Schema: ss14Schema as Schema };
