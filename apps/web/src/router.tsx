import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { isJwtValid } from './lib/jwt';
import { tokenStorage } from './lib/token-storage';
import { LoginPage } from './routes/Login';
import { DashboardPage } from './routes/Dashboard';

// Code-based routing (no codegen). The route tree is tiny — `/login` and
// `/` plus a catch-all "next" param. Once we add more routes per
// PROJECT.md §7 we can switch to file-based routing with
// @tanstack/router-plugin, but for v1 this is one less moving part.

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  // Per Auth.md §12.4: if a valid access token already exists, skip the form.
  beforeLoad: () => {
    if (isJwtValid(tokenStorage.getAccessToken())) {
      throw redirect({ to: '/' });
    }
  },
  // `?next=/some/path` survives an unauth redirect so we can return the user
  // there after a successful login.
  validateSearch: (search: Record<string, unknown>): { next?: string } => {
    const next = typeof search.next === 'string' ? search.next : undefined;
    // Only allow same-origin paths — refuse anything that looks like an
    // off-site redirect (defence against open-redirect abuse if the URL is
    // ever shared).
    return { next: next && next.startsWith('/') && !next.startsWith('//') ? next : undefined };
  },
  component: LoginPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  // Per Auth.md §12.4: missing token → bounce to /login with ?next=. An
  // expired-but-present token is allowed through — the Axios interceptor
  // will refresh on the first API call, avoiding a redirect flash.
  beforeLoad: ({ location }) => {
    const access = tokenStorage.getAccessToken();
    const refresh = tokenStorage.getRefreshToken();
    if (!access && !refresh) {
      throw redirect({
        to: '/login',
        search: { next: location.pathname === '/' ? undefined : location.pathname },
      });
    }
  },
  component: DashboardPage,
});

const routeTree = rootRoute.addChildren([loginRoute, dashboardRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

// TanStack Router needs a module-augmentation so `<Link to=...>` autocompletes.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
