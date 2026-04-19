// /cryo — dedicated cryo procedures page. Pulls the patient-prep + gas-swap
// rules directly from the "Cryo workflow" and "Species-specific medicine"
// sections of pro-tips.md so there's one source of truth.

import { Link } from 'react-router-dom';
import { CopyLabelButton } from '../components/CopyLabelButton';
import { ProTipCallout } from '../components/ProTipCallout';
import proTipsSource from '../data/pro-tips.md?raw';
import {
  type ProTipBullet,
  type ProTipSection,
  parseProTips,
} from '../data/pro-tips-parser';
import { useData } from '../data/store';

const CRYO_CHEMS = [
  {
    id: 'Cryoxadone',
    tagline: 'Primary cryo chem — heals most damage at body temp ≤ 213K.',
  },
  {
    id: 'Aloxadone',
    tagline: 'Secondary cryo chem — burn-specialized, cheap backup.',
  },
  {
    id: 'Opporozidone',
    tagline:
      'Rotted-corpse revival. Hot-plate cook (plasma consumed). Target 150K.',
  },
  {
    id: 'Doxarubixadone',
    tagline: 'Cellular repair booster; pairs with cryoxadone in long holds.',
  },
];

/** Return bullets from sections whose heading contains `needle`. */
function sectionBullets(
  sections: readonly ProTipSection[],
  needle: string,
): ProTipBullet[] {
  const out: ProTipBullet[] = [];
  for (const s of sections) {
    if (s.heading.toLowerCase().includes(needle.toLowerCase())) {
      out.push(...s.bullets);
      for (const sub of s.subsections) {
        out.push(...sub.bullets);
      }
    }
    for (const sub of s.subsections) {
      if (sub.heading.toLowerCase().includes(needle.toLowerCase())) {
        out.push(...sub.bullets);
      }
    }
  }
  return out;
}

export function CryoPage() {
  const data = useData();
  const doc = parseProTips(proTipsSource);

  const cryoBullets = sectionBullets(doc.sections, 'cryo');
  const voxBullets = sectionBullets(doc.sections, 'vox');

  return (
    <div className="cryo-page">
      <header className="page-head">
        <h1>Cryo</h1>
        <p className="tagline">
          The four cryo chems, patient prep, and gas-swap rules (Vox, etc.).
          Tips sourced from <Link to="/pro-tips">pro-tips</Link>.
        </p>
      </header>

      <section>
        <h2>Chems</h2>
        <div className="cryo-chem-grid">
          {CRYO_CHEMS.map((c) => {
            const exists = data.reagentsById.has(c.id);
            return (
              <article key={c.id} className="cryo-chem-card">
                <h3>
                  {exists ? (
                    <Link to={`/reagents/${c.id}`}>{c.id}</Link>
                  ) : (
                    <>
                      {c.id} <span className="muted">(not in data bundle)</span>
                    </>
                  )}
                </h3>
                <p>{c.tagline}</p>
                {exists && <CopyLabelButton reagentId={c.id} units={30} />}
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <h2>Patient prep checklist</h2>
        <ol className="prep-list">
          <li>Strip the patient's exosuit.</li>
          <li>Load them into the cryo tube (head-first).</li>
          <li>
            Load cryoxadone (and doxarubixadone if cellular damage &gt; 0).
          </li>
          <li>Close the tube, set freezer ≤ 100K.</li>
          <li>
            Wait for body temp to drop to the chem's threshold (213K for
            cryoxadone, 150K for opporozidone).
          </li>
          <li>
            Monitor until damage totals cross below 5 across all categories.
          </li>
        </ol>
      </section>

      <section>
        <h2>Cryo-gas swap rules</h2>
        <p>
          Standard cryo gas is 79/21 N2/O2 — toxic to Vox. Before loading a Vox
          patient:
        </p>
        <ul>
          <li>Reset the freezer's gas filter to pure nitrogen, OR</li>
          <li>Remove the O2 canister.</li>
        </ul>
        <p>
          Other species that breathe non-standard gases (slime people with N2O
          is folk-wisdom, not verified) follow the same pattern — whenever in
          doubt, check the species page.
        </p>
      </section>

      <section>
        <h2>Tips — cryo workflow</h2>
        {cryoBullets.length === 0 && <p className="muted">No tips found.</p>}
        {cryoBullets.map((b, idx) => (
          <ProTipCallout key={`c-${idx}`} bullet={b} />
        ))}
      </section>

      <section>
        <h2>Tips — Vox (the gas-swap rule lives here)</h2>
        {voxBullets.length === 0 && <p className="muted">No tips found.</p>}
        {voxBullets.map((b, idx) => (
          <ProTipCallout key={`v-${idx}`} bullet={b} />
        ))}
      </section>
    </div>
  );
}
