// Global keyboard shortcuts:
//   /              focus the search input (first [data-search-input])
//   g <letter>     jump to a route — g r -> /reagents, g s -> /solver, etc.
//   esc            clear focus + fire a custom "nurseshark:escape" event
//   c              copy the nearest "label" (the route pages that care hook
//                  this custom event themselves)
//
// We implement it as a tiny FSM so `g` + letter works: pressing `g` alone
// arms a 1.5s window in which the next key is interpreted as a nav target.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const SECTION_JUMPS: Record<string, string> = {
  r: '/reagents',
  x: '/reactions',
  s: '/solver',
  d: '/damage',
  p: '/species',
  c: '/cryo',
  t: '/pro-tips',
  a: '/about',
};

/** Are we typing into an editable element right now? */
function inInput(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) {
    return false;
  }
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return el.isContentEditable;
}

export function useKeyboardShortcuts(): void {
  const navigate = useNavigate();

  useEffect(() => {
    let gArmed: number | null = null;

    const disarm = () => {
      if (gArmed !== null) {
        window.clearTimeout(gArmed);
        gArmed = null;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      // Never fire when user is typing in a form field. Exception: `/` can
      // either focus the search (if not in input) or be silenced (if in
      // input) — we just never preempt typing.
      if (inInput(e.target)) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      if (e.key === 'Escape') {
        disarm();
        (document.activeElement as HTMLElement | null)?.blur?.();
        window.dispatchEvent(new CustomEvent('nurseshark:escape'));
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>(
          '[data-search-input]',
        );
        el?.focus();
        el?.select();
        return;
      }

      if (gArmed !== null) {
        const target = SECTION_JUMPS[e.key.toLowerCase()];
        disarm();
        if (target) {
          e.preventDefault();
          navigate(target);
        }
        return;
      }

      if (e.key === 'g') {
        gArmed = window.setTimeout(disarm, 1500);
        return;
      }

      if (e.key === 'c') {
        window.dispatchEvent(new CustomEvent('nurseshark:copy-label'));
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      disarm();
      window.removeEventListener('keydown', onKey);
    };
  }, [navigate]);
}
