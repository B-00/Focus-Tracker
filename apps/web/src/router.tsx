import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { AppShell } from './components/AppShell';
import { isJwtValid } from './lib/jwt';
import { tokenStorage } from './lib/token-storage';
import { LoginPage } from './routes/Login';
import { DashboardPage } from './routes/Dashboard';
import { SettingsPage } from './routes/Settings';
import { ActivityPage } from './routes/Activity';

// Code-based routing (no codegen). Tree:
//
//   /login        — unauthenticated form
//   /             — AppShell-wrapped protected layout
//     /           — Dashboard
//     /settings   — Settings (hash-based subsection switching, see Settings.tsx)
//
// Once we add more protected routes per PROJECT.md §7 we can switch to
// file-based routing with @tanstack/router-plugin; for v1 this is one
// less moving part.

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

/// Layout route: anything under this gets the AppShell (header nav,
/// sign-out, future sticky session bar). The auth guard fires once at
/// the layout level so we don't repeat it on every leaf route.
const protectedLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
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
  component: AppShell,
});

const dashboardRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/',
  component: DashboardPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/settings',
  component: SettingsPage,
});

const activityRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/activity',
  component: ActivityPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedLayout.addChildren([dashboardRoute, activityRoute, settingsRoute]),
]);

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
