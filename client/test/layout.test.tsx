import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS } from '../src/app/navigation';
import { healthBody, mockFetch, renderRoute } from './utils';

describe('AppLayout', () => {
  it('shows a menu section for every module in spec §15', async () => {
    mockFetch(200, healthBody());
    renderRoute('/');

    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const section of [
      'Dashboard',
      'Inventory',
      'Purchasing',
      'Workshop',
      'Sales',
      'Finance',
      'Reports',
      'Settings',
      'Audit',
    ]) {
      expect(within(nav).getByRole('heading', { name: section })).toBeInTheDocument();
    }
    const linkCount = NAV_SECTIONS.reduce((n, s) => n + s.items.length, 0);
    // +1 for the System status link.
    expect(within(nav).getAllByRole('link')).toHaveLength(linkCount + 1);
  });

  it('renders a placeholder naming the phase that delivers a page', async () => {
    mockFetch(200, healthBody());
    renderRoute('/purchasing/landed-costs');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Landed costs' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Phase 3')).toBeInTheDocument();
  });

  it('navigates when a menu link is clicked', async () => {
    mockFetch(200, healthBody());
    renderRoute('/');

    await userEvent.click(await screen.findByRole('link', { name: 'Stock balances' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Stock balances' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stock balances' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('toggles the mobile menu button', async () => {
    mockFetch(200, healthBody());
    renderRoute('/');

    const button = await screen.findByRole('button', { name: 'Open menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows the API status in the top bar', async () => {
    mockFetch(200, healthBody());
    renderRoute('/');
    expect(await screen.findByText('Online')).toBeInTheDocument();
  });
});
