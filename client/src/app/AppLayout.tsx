import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { useHealth } from '../features/system/useHealth';
import { NAV_SECTIONS, SYSTEM_STATUS_PATH } from './navigation';

function navLinkClass({ isActive }: { isActive: boolean }) {
  return `block rounded-md px-3 py-1.5 text-sm transition-colors ${
    isActive
      ? 'bg-navy-700 font-medium text-white'
      : 'text-navy-200 hover:bg-navy-800 hover:text-white'
  }`;
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-navy-800 px-5">
        <span className="grid size-8 place-items-center rounded-lg bg-blue-600 text-sm font-bold text-white">
          IM
        </span>
        <span className="text-sm font-semibold leading-tight text-white">
          Inventory &amp;
          <br />
          Manufacturing
        </span>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id}>
            <h2 className="mb-1 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wider text-navy-300">
              <Icon name={section.icon} className="size-4" />
              {section.label}
            </h2>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.path}>
                  <NavLink to={item.path} end className={navLinkClass} onClick={onNavigate}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-navy-800 px-3 py-3">
        <NavLink to={SYSTEM_STATUS_PATH} className={navLinkClass} onClick={onNavigate}>
          <span className="flex items-center gap-2">
            <Icon name="status" className="size-4" />
            System status
          </span>
        </NavLink>
      </div>
    </nav>
  );
}

function ApiStatusPill() {
  const { data, error, isPending } = useHealth();
  let badge;
  if (isPending) badge = <StatusBadge tone="neutral">Checking</StatusBadge>;
  else if (error && !data) badge = <StatusBadge tone="danger">API offline</StatusBadge>;
  else if (data?.status === 'ok') badge = <StatusBadge tone="success">Online</StatusBadge>;
  else badge = <StatusBadge tone="warning">Degraded</StatusBadge>;
  return (
    <Link to={SYSTEM_STATUS_PATH} aria-label="System status" className="rounded-full">
      {badge}
    </Link>
  );
}

/** Navy sidebar, top bar and white content area (spec §15). Sidebar becomes a drawer below `lg`. */
export function AppLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-dvh">
      {/* Mobile / tablet drawer */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="sidebar"
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-navy-900 transition-transform lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onNavigate={() => setOpen(false)} />
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
          <button
            type="button"
            className="-ml-1 rounded-md p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-controls="sidebar"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? 'close' : 'menu'} />
          </button>
          <p className="truncate text-sm text-slate-500" title={location.pathname}>
            {location.pathname}
          </p>
          <div className="ml-auto flex items-center gap-3">
            <ApiStatusPill />
            {/* TODO(phase-1): signed-in user menu with logout. */}
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
