// Smoke/snapshot tests — every route should render without throwing.
// We use MemoryRouter + the real data bundle via DataProvider; the test
// setup stubs fetch to return the on-disk JSON.

import { Route } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '../../test/render-helpers';
import { AboutPage } from '../AboutPage';
import { CryoPage } from '../CryoPage';
import { DamageDetailPage } from '../DamageDetailPage';
import { DamagePage } from '../DamagePage';
import { ProTipsPage } from '../ProTipsPage';
import { ReactionsPage } from '../ReactionsPage';
import { ReagentDetailPage } from '../ReagentDetailPage';
import { ReagentsPage } from '../ReagentsPage';
import { SolverPage } from '../SolverPage';
import { SpeciesPage } from '../SpeciesPage';

describe('routes', () => {
  it('/reagents lists reagents', async () => {
    const { container } = await renderRoute(
      '/reagents',
      <Route path="/reagents" element={<ReagentsPage />} />,
    );
    expect(container.textContent).toContain('Reagents');
    // We know there should be a sizable count.
    expect(container.querySelectorAll('.reagent-card').length).toBeGreaterThan(
      10,
    );
  });

  it('/reagents/Bicaridine renders detail', async () => {
    const { container } = await renderRoute(
      '/reagents/Bicaridine',
      <Route path="/reagents/:id" element={<ReagentDetailPage />} />,
    );
    expect(container.textContent).toMatch(/Bicaridine|Bicar|bicaridine/i);
  });

  it('/reactions renders browser', async () => {
    const { container } = await renderRoute(
      '/reactions',
      <Route path="/reactions" element={<ReactionsPage />} />,
    );
    expect(container.textContent).toContain('Reactions');
    expect(container.querySelectorAll('.reaction-row').length).toBeGreaterThan(
      10,
    );
  });

  it('/damage lists groups', async () => {
    const { container } = await renderRoute(
      '/damage',
      <Route path="/damage" element={<DamagePage />} />,
    );
    expect(container.textContent).toContain('Damage');
    expect(container.textContent).toContain('Brute');
  });

  it('/damage/Blunt renders a detail page', async () => {
    const { container } = await renderRoute(
      '/damage/Blunt',
      <Route path="/damage/:type" element={<DamageDetailPage />} />,
    );
    expect(container.textContent).toContain('Blunt');
  });

  it('/species renders cards', async () => {
    const { container } = await renderRoute(
      '/species',
      <Route path="/species" element={<SpeciesPage />} />,
    );
    expect(container.textContent).toContain('Species');
    // Vox must appear (it's one of the known species IDs).
    expect(container.textContent?.toLowerCase()).toContain('vox');
  });

  it('/cryo renders chem cards', async () => {
    const { container } = await renderRoute(
      '/cryo',
      <Route path="/cryo" element={<CryoPage />} />,
    );
    expect(container.textContent).toContain('Cryoxadone');
    expect(container.textContent).toContain('Opporozidone');
  });

  it('/pro-tips renders sections', async () => {
    const { container } = await renderRoute(
      '/pro-tips',
      <Route path="/pro-tips" element={<ProTipsPage />} />,
    );
    expect(container.textContent).toContain('Pro Tips');
    // Every section header we know exists.
    expect(container.textContent).toMatch(/Cryo|Brute/i);
  });

  it('/about renders meta', async () => {
    const { container } = await renderRoute(
      '/about',
      <Route path="/about" element={<AboutPage />} />,
    );
    expect(container.textContent).toContain('About Nurseshark');
    expect(container.textContent).toContain('Nurseshark version');
  });

  it('/solver shell renders without computing', async () => {
    const { container } = await renderRoute(
      '/solver',
      <Route path="/solver" element={<SolverPage />} />,
    );
    expect(container.textContent).toContain('Rx Solver');
    // The form is present.
    expect(container.querySelector('form.solver-form')).toBeTruthy();
  });
});
