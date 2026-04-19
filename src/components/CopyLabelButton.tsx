// One-click clipboard button producing the operator-label format from
// pro-tips.md: "<reagent> / <units>u / <initials> HH:MM".
//
// Used both on reagent detail pages and (eventually) solver output. Also
// listens for the global "nurseshark:copy-label" event so pressing `c`
// copies whichever CopyLabelButton is currently mounted in the detail view.

import { useCallback, useEffect, useState } from 'react';
import { prettifyId, resolveFluentKey } from '../data/fluent';
import { useData } from '../data/store';

export interface CopyLabelButtonProps {
  readonly reagentId: string;
  readonly units: number;
  readonly operatorName?: string;
  /** If true, register a global listener for keyboard-shortcut-triggered copy. */
  readonly registerGlobalCopy?: boolean;
}

function operatorInitials(name: string | undefined): string {
  if (!name) {
    return 'AZ'; // placeholder used in pro-tips.md sample
  }
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function nowHHMM(): string {
  const d = new Date();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Build the label string for display / copy. */
export function buildLabel({
  reagentName,
  units,
  operatorName,
  clock = nowHHMM(),
}: {
  reagentName: string;
  units: number;
  operatorName?: string;
  clock?: string;
}): string {
  // Short-name: first word of the reagent name, capitalized.
  const firstWord = reagentName.split(/\s+/)[0];
  const short = firstWord.length > 10 ? firstWord.slice(0, 8) : firstWord;
  return `${short} / ${units}u / ${operatorInitials(operatorName)} ${clock}`;
}

export function CopyLabelButton({
  reagentId,
  units,
  operatorName,
  registerGlobalCopy = false,
}: CopyLabelButtonProps) {
  const data = useData();
  const reagent = data.reagentsById.get(reagentId);
  const name = reagent
    ? resolveFluentKey(data.fluent, reagent.name) || prettifyId(reagentId)
    : prettifyId(reagentId);

  const [copied, setCopied] = useState(false);

  const doCopy = useCallback(async () => {
    const text = buildLabel({ reagentName: name, units, operatorName });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // no-op — clipboard may be unavailable in non-secure contexts.
    }
  }, [name, units, operatorName]);

  useEffect(() => {
    if (!registerGlobalCopy) {
      return;
    }
    const handler = () => {
      void doCopy();
    };
    window.addEventListener('nurseshark:copy-label', handler);
    return () => window.removeEventListener('nurseshark:copy-label', handler);
  }, [registerGlobalCopy, doCopy]);

  return (
    <button
      type="button"
      onClick={doCopy}
      className="copy-label-btn"
      aria-label={`Copy label for ${name}`}
    >
      {copied ? 'Copied!' : 'Copy label'}
    </button>
  );
}
