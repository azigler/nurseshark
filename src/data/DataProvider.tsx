// Loads the entire public/data/*.json bundle on mount. Children see one of
// three states: loading / error / ready.

import { type ReactNode, useEffect, useState } from 'react';
import { DataContext, type LoadState, loadDataBundle } from './store';

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({
    status: 'loading',
    error: null,
    data: null,
  });

  useEffect(() => {
    let cancelled = false;
    loadDataBundle().then(
      (data) => {
        if (!cancelled) {
          setState({ status: 'ready', error: null, data });
        }
      },
      (err: Error) => {
        if (!cancelled) {
          setState({ status: 'error', error: err.message, data: null });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}
