// Tests the `!type:X` -> `__type: X` rewrite that lets js-yaml parse
// SS14's custom tags without an explicit whitelist.
import { load as parseYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { rewriteSs14TypeTags } from '../read-yaml';

describe('rewriteSs14TypeTags', () => {
  it('converts a list-element tag to a __type key', () => {
    const src = [
      'effects:',
      '- !type:HealthChange',
      '  damage:',
      '    types:',
      '      Blunt: -1',
    ].join('\n');
    const rewritten = rewriteSs14TypeTags(src);
    const doc = parseYaml(rewritten) as {
      effects: Array<Record<string, unknown>>;
    };
    expect(doc.effects[0].__type).toBe('HealthChange');
    expect(doc.effects[0].damage).toEqual({ types: { Blunt: -1 } });
  });

  it('handles flow-form empty-body tags `!type:Foo { }`', () => {
    const src = ['tileReactions:', '- !type:ExtinguishTileReaction { }'].join(
      '\n',
    );
    const rewritten = rewriteSs14TypeTags(src);
    const doc = parseYaml(rewritten) as {
      tileReactions: Array<Record<string, unknown>>;
    };
    expect(doc.tileReactions[0].__type).toBe('ExtinguishTileReaction');
  });

  it('handles a trailing comment on the tag line', () => {
    const src = [
      '- !type:HealthChange # healing effect',
      '  damage:',
      '    types:',
      '      Heat: -2',
    ].join('\n');
    const rewritten = rewriteSs14TypeTags(src);
    const doc = parseYaml(rewritten) as Array<Record<string, unknown>>;
    expect(doc[0].__type).toBe('HealthChange');
  });

  it('leaves non-tag lines untouched', () => {
    const src = [
      '- type: reagent',
      '  id: Bicaridine',
      "  color: '#ffaa00'",
    ].join('\n');
    expect(rewriteSs14TypeTags(src)).toBe(src);
  });
});
