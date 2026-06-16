import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { registerSessionInvalidHandler } from './lib/api';
import { useAuthStore } from './stores/auth-store';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Hook the Axios interceptor (Auth.md §12.3) into the router. When a refresh
// attempt fails terminally, the interceptor clears localStorage and calls
// this handler — which wipes the in-memory auth store and bounces the user
// to /login.
registerSessionInvalidHandler(() => {
  useAuthStore.getState().resetSession();
  void router.navigate({
    to: '/login',
    search: { next: window.location.pathname },
  });
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('No #root element found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
