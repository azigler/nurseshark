// Test helpers for rendering a route with the real data bundle loaded.

import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Routes } from 'react-router-dom';
import { DataProvider } from '../data/DataProvider';
import { useLoadState } from '../data/store';

function LoadGate({ children }: { children: ReactNode }) {
  const state = useLoadState();
  if (state.status !== 'ready') {
    return null;
  }
  return <>{children}</>;
}

/**
 * Render a sub-tree with the real DataProvider + MemoryRouter. Waits until
 * the provider has finished loading — routes that call `useData()` throw if
 * we render them before data is ready, so we gate the whole tree.
 */
export async function renderRoute(path: string, routes: ReactNode) {
  const utils = render(
    <DataProvider>
      <LoadGate>
        <MemoryRouter initialEntries={[path]}>
          <Routes>{routes}</Routes>
        </MemoryRouter>
      </LoadGate>
    </DataProvider>,
  );
  await waitFor(
    () => {
      // Nothing renders until data is ready. Wait for the route root to
      // populate (non-empty textContent).
      if (!utils.container.textContent || utils.container.textContent === '') {
        throw new Error('still loading');
      }
    },
    { timeout: 5000 },
  );
  return utils;
}
