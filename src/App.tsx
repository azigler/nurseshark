import './App.css';

export function App() {
  return (
    <main className="app">
      <header className="app-header">
        <h1>Nurseshark</h1>
        <p className="tagline">
          Chemistry, medical, and cryo reference for Space Station 14.
        </p>
      </header>
      <section className="placeholder">
        <p>
          Under construction. See{' '}
          <a href="https://github.com/azigler/nurseshark">
            github.com/azigler/nurseshark
          </a>{' '}
          for progress.
        </p>
      </section>
    </main>
  );
}
