// Unit tests for the shared component primitives.

import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../../data/DataProvider';
import type { ProTipBullet } from '../../data/pro-tips-parser';
import { useData, useLoadState } from '../../data/store';
import { buildLabel, CopyLabelButton } from '../CopyLabelButton';
import { ProTipCallout } from '../ProTipCallout';
import { ReagentCard } from '../ReagentCard';
import { SearchBar } from '../SearchBar';

function WithData({ children }: { children: React.ReactNode }) {
  return (
    <DataProvider>
      <LoadGate>
        <MemoryRouter>{children}</MemoryRouter>
      </LoadGate>
    </DataProvider>
  );
}

function LoadGate({ children }: { children: React.ReactNode }) {
  const state = useLoadState();
  if (state.status !== 'ready') {
    return null;
  }
  return <>{children}</>;
}

describe('buildLabel', () => {
  it('produces the pro-tips label format', () => {
    const s = buildLabel({
      reagentName: 'Bicaridine',
      units: 30,
      operatorName: 'Andrew Zigler',
      clock: '14:22',
    });
    expect(s).toBe('Bicaridine / 30u / AZ 14:22');
  });

  it('uses placeholder initials when operator omitted', () => {
    const s = buildLabel({
      reagentName: 'Omnizine',
      units: 15,
      clock: '09:00',
    });
    expect(s).toMatch(/\/ 15u \/ [A-Z]{2} 09:00$/);
  });
});

describe('CopyLabelButton', () => {
  it('renders and triggers clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const { getByText, container } = render(
      <WithData>
        <Inner />
      </WithData>,
    );

    function Inner() {
      const data = useData();
      // Require data before rendering.
      if (!data.reagents.length) return null;
      return <CopyLabelButton reagentId="Bicaridine" units={30} />;
    }

    await waitFor(() => {
      expect(container.querySelector('.copy-label-btn')).toBeTruthy();
    });

    fireEvent.click(getByText('Copy label'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
  });
});

describe('SearchBar', () => {
  it('shows results for a known reagent query', async () => {
    const onSelect = vi.fn();
    const { container, getByRole } = render(
      <WithData>
        <SearchBar onSelect={onSelect} />
      </WithData>,
    );
    await waitFor(() => {
      expect(container.querySelector('.search-bar input')).toBeTruthy();
    });
    const input = getByRole('combobox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'bicar' } });
    await waitFor(() => {
      expect(container.querySelector('.search-results')).toBeTruthy();
    });
    expect(container.querySelectorAll('.search-result').length).toBeGreaterThan(
      0,
    );
  });
});

describe('ReagentCard', () => {
  it('renders a card with the reagent name', async () => {
    const { container } = render(
      <WithData>
        <ReagentCardInner />
      </WithData>,
    );
    function ReagentCardInner() {
      const data = useData();
      const r = data.reagentsById.get('Bicaridine');
      if (!r) return null;
      return <ReagentCard reagent={r} />;
    }
    await waitFor(() => {
      expect(container.querySelector('.reagent-card')).toBeTruthy();
    });
  });
});

describe('ProTipCallout', () => {
  const bullet: ProTipBullet = {
    tag: 'verified',
    body: 'Bicaridine recipe is **1 : 0.9 : 1**.',
    children: [],
  };

  it('renders tag + inline-markdown body', () => {
    const { container } = render(<ProTipCallout bullet={bullet} />);
    expect(container.querySelector('.pro-tip-verified')).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toContain(
      '1 : 0.9 : 1',
    );
    expect(container.textContent).toContain('[verified]');
  });
});
