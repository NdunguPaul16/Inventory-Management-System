import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth-context';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return (
      <p role="status" className="p-8 text-center text-slate-600">
        Checking your session…
      </p>
    );
  }
  if (status === 'anonymous') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }
  return <Outlet />;
}
