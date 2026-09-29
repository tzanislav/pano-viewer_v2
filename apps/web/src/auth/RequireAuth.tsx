import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function RequireAuth() {
  const { ready, user } = useAuth();
  const location = useLocation();
  if (!ready) return <main className="loading-screen">Restoring your session…</main>;
  if (!user) return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}
