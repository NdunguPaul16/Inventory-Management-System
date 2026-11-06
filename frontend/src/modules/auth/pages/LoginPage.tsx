import { Navigate, useLocation } from 'react-router';
import { LoginForm } from '../components/LoginForm';
import { useAuth } from '../auth-context';

function safeReturnPath(value: unknown): string {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !value.startsWith('/login')
    ? value
    : '/';
}

export function LoginPage() {
  const { status } = useAuth();
  const location = useLocation();
  const returnTo = safeReturnPath((location.state as { from?: unknown } | null)?.from);

  if (status === 'checking') {
    return (
      <p role="status" className="p-8 text-center text-slate-600">
        Checking your session…
      </p>
    );
  }
  if (status === 'authenticated') return <Navigate to={returnTo} replace />;

  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="relative flex flex-col justify-between overflow-hidden bg-navy-950 px-6 py-8 text-white sm:px-10 lg:px-16 lg:py-12">
        <div
          className="absolute -right-24 -top-24 size-72 rounded-full bg-blue-700/15 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-sm font-bold shadow-lg shadow-blue-950/30">
            IM
          </span>
          <span className="text-sm font-semibold leading-tight tracking-wide">
            Inventory &amp;
            <br />
            Manufacturing
          </span>
        </div>
        <div className="relative hidden max-w-lg lg:block">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-blue-300">
            Your workspace
          </p>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            Know where every item stands.
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-navy-200">
            A clear view of stock, operations and the people behind them.
          </p>
        </div>
        <p className="relative hidden text-xs text-navy-300 lg:block">
          Inventory Management System
        </p>
      </div>

      <main className="flex items-center justify-center px-6 py-12 sm:px-10 lg:px-16">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
              Welcome back
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-navy-950">
              Sign in to your account
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Use the credentials provided by your administrator.
            </p>
          </div>
          <LoginForm returnTo={returnTo} />
        </div>
      </main>
    </div>
  );
}
