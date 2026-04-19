// Root application. Wires the Router + DataProvider + route table.

import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DataProvider } from './data/DataProvider';
import { useLoadState } from './data/store';
import { AboutPage } from './routes/AboutPage';
import { CryoPage } from './routes/CryoPage';
import { DamageDetailPage } from './routes/DamageDetailPage';
import { DamagePage } from './routes/DamagePage';
import { ProTipsPage } from './routes/ProTipsPage';
import { ReactionsPage } from './routes/ReactionsPage';
import { ReagentDetailPage } from './routes/ReagentDetailPage';
import { ReagentsPage } from './routes/ReagentsPage';
import { SolverPage } from './routes/SolverPage';
import { SpeciesPage } from './routes/SpeciesPage';
import './App.css';

function LoadGate({ children }: { children: ReactNode }) {
  const state = useLoadState();
  if (state.status === 'loading') {
    return (
      <div className="load-screen">
        <p>Loading Nurseshark data…</p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="load-screen load-screen-error">
        <h1>Failed to load data</h1>
        <p>{state.error}</p>
        <p>
          If you're in development, make sure <code>npm run gen</code> has been
          run at least once. See <code>sources.yml</code>.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  const basename = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || '/';

  return (
    <DataProvider>
      <BrowserRouter basename={basename}>
        <LoadGate>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/solver" replace />} />
              <Route path="solver" element={<SolverPage />} />
              <Route path="reagents" element={<ReagentsPage />} />
              <Route path="reagents/:id" element={<ReagentDetailPage />} />
              <Route path="reactions" element={<ReactionsPage />} />
              <Route path="damage" element={<DamagePage />} />
              <Route path="damage/:type" element={<DamageDetailPage />} />
              <Route path="species" element={<SpeciesPage />} />
              <Route path="cryo" element={<CryoPage />} />
              <Route path="pro-tips" element={<ProTipsPage />} />
              <Route path="about" element={<AboutPage />} />
              <Route
                path="*"
                element={
                  <div className="not-found">
                    <h1>Route not found</h1>
                  </div>
                }
              />
            </Route>
          </Routes>
        </LoadGate>
      </BrowserRouter>
    </DataProvider>
  );
}
