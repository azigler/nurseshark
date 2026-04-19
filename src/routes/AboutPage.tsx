// /about — credits, license, inspirations, version from meta.json.

import { useData } from '../data/store';

export function AboutPage() {
  const data = useData();
  const { meta } = data;
  const shortSha = meta.ss14CommitSha ? meta.ss14CommitSha.slice(0, 12) : null;

  return (
    <div className="about-page">
      <header className="page-head">
        <h1>About Nurseshark</h1>
        <p className="tagline">
          Chemistry, medical, and cryo companion for{' '}
          <a
            href="https://github.com/space-wizards/space-station-14"
            target="_blank"
            rel="noopener noreferrer"
          >
            Space Station 14
          </a>
          . A first-party tool of{' '}
          <a
            href="https://github.com/azigler/vacation-station-14"
            target="_blank"
            rel="noopener noreferrer"
          >
            Vacation Station 14
          </a>
          .
        </p>
      </header>

      <section>
        <h2>Build metadata</h2>
        <dl className="build-meta">
          <dt>Nurseshark version</dt>
          <dd>
            <code>{meta.nursesharkVersion}</code>
          </dd>
          <dt>SS14 / VS14 source commit</dt>
          <dd>
            {shortSha ? (
              <code title={meta.ss14CommitSha ?? undefined}>{shortSha}</code>
            ) : (
              <span className="muted">unknown</span>
            )}
          </dd>
          <dt>Built at</dt>
          <dd>{new Date(meta.builtAt).toUTCString()}</dd>
          <dt>Bundle counts</dt>
          <dd>
            {data.reagents.length} reagents · {data.reactions.length} reactions
            · {data.damage.length} damage types · {data.species.length} species
            · {data.containers.length} containers ·{' '}
            {Object.keys(data.fluent).length} Fluent keys
          </dd>
        </dl>
      </section>

      <section>
        <h2>License</h2>
        <p>
          Nurseshark is AGPLv3-or-later, matching VS14's first-party code
          license boundary. Game content (reagent names, descriptions, sprites,
          species notes) is MIT (SS14 upstream) / CC-BY-SA (assets) and is
          re-used under those licenses.
        </p>
      </section>

      <section>
        <h2>Inspirations</h2>
        <ul>
          <li>
            <a
              href="https://github.com/arimah/ss14-cookbook"
              target="_blank"
              rel="noopener noreferrer"
            >
              SS14 Cookbook
            </a>{' '}
            — the structural cue for "parse the game YAML, ship a static site
            with cards." No shared code.
          </li>
          <li>
            <a
              href="https://hoshizora-sayo.github.io/bugmedical/"
              target="_blank"
              rel="noopener noreferrer"
            >
              bugmedical
            </a>{' '}
            — content organization inspiration (damage-type sections, pro-tip
            callouts). All content is re-generated from the data pipeline.
          </li>
        </ul>
      </section>

      <section>
        <h2>Keyboard shortcuts</h2>
        <ul className="kbd-list">
          <li>
            <kbd>/</kbd> — focus search
          </li>
          <li>
            <kbd>g</kbd> + <kbd>r</kbd> — reagents; <kbd>g</kbd> <kbd>x</kbd> —
            reactions; <kbd>g</kbd> <kbd>s</kbd> — solver; <kbd>g</kbd>{' '}
            <kbd>d</kbd> — damage; <kbd>g</kbd> <kbd>p</kbd> — species;{' '}
            <kbd>g</kbd> <kbd>c</kbd> — cryo; <kbd>g</kbd> <kbd>t</kbd> —
            pro-tips; <kbd>g</kbd> <kbd>a</kbd> — about
          </li>
          <li>
            <kbd>c</kbd> — copy the focused reagent's label
          </li>
          <li>
            <kbd>esc</kbd> — clear search / close modals
          </li>
        </ul>
      </section>
    </div>
  );
}
