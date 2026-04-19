// Top-level layout: header with logo + nav + search, main <Outlet/>, footer.
// The keyboard shortcut hook lives here so it wires up once at mount.

import { NavLink, Outlet } from 'react-router-dom';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { SearchBar } from './SearchBar';

const NAV_ITEMS = [
  { to: '/solver', label: 'Solver (Rx)', hint: 'g s' },
  { to: '/reagents', label: 'Reagents', hint: 'g r' },
  { to: '/reactions', label: 'Reactions', hint: 'g x' },
  { to: '/damage', label: 'Damage', hint: 'g d' },
  { to: '/species', label: 'Species', hint: 'g p' },
  { to: '/cryo', label: 'Cryo', hint: 'g c' },
  { to: '/pro-tips', label: 'Pro Tips', hint: 'g t' },
  { to: '/about', label: 'About', hint: 'g a' },
];

export function Layout() {
  useKeyboardShortcuts();

  return (
    <div className="app-shell">
      <header className="nav-header">
        <div className="nav-top">
          <NavLink to="/" className="brand" end>
            <span className="brand-mark" aria-hidden="true">
              🦈
            </span>
            <span className="brand-text">Nurseshark</span>
          </NavLink>
          <SearchBar className="nav-search" />
        </div>
        <nav className="nav-links" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
              title={`Press ${item.hint}`}
            >
              {item.label}
              <span className="nav-hint">{item.hint}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <small>
          Nurseshark · AGPLv3 · Generated from SS14/VS14 YAML · Press{' '}
          <kbd>/</kbd> to search, <kbd>g</kbd> + letter to jump sections,{' '}
          <kbd>esc</kbd> to clear.
        </small>
      </footer>
    </div>
  );
}
