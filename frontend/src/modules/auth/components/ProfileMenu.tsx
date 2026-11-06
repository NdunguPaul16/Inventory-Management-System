import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth-context';

export function ProfileMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function onLogout() {
    setBusy(true);
    setError(null);
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch {
      setError('Could not sign out. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Profile menu for ${user.name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className="grid size-8 place-items-center rounded-full bg-navy-900 text-xs font-semibold text-white">
          {user.name.trim().slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden max-w-36 truncate text-sm font-medium text-slate-800 sm:block">
          {user.name}
        </span>
        <span className="text-xs text-slate-500" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <p className="mt-1 text-xs text-slate-500">
              {user.roles.map((role) => role.name).join(', ')}
            </p>
          </div>
          {error && (
            <p role="alert" className="px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => void onLogout()}
            disabled={busy}
            className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
