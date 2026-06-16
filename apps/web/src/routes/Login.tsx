import { useState, type FormEvent } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { loginRequestSchema, type AuthErrorCode, type LoginResponse } from '@focus-tracker/shared';
import { login as apiLogin } from '../lib/auth-api';
import { useAuthStore } from '../stores/auth-store';

// Login form per Auth.md §12.1 / §14 / §15.
// - Single column, max-width ~360px, centered.
// - Real <form>, <label for>, aria-invalid, aria-describedby.
// - Error region role="alert" aria-live="assertive".
// - Dev-only "no_user_seeded" hint as a role="note" banner above the form.

interface FormError {
  /// Maps to one of AUTH_ERROR_CODES or a synthetic local code for client
  /// validation / network failures. Drives the inline message.
  code: AuthErrorCode | 'validation_failed' | 'network';
  /// Human-readable message. For server errors, we always show the canonical
  /// constant string per §4.1 / §12.1 — we don't echo the server's hint
  /// (would defeat the constant-time login posture).
  message: string;
  /// Optional dev hint (only set for `no_user_seeded`) — rendered as a
  /// separate banner. Server-supplied verbatim.
  hint?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { next } = useSearch({ from: '/login' });
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);

  const mutation = useMutation<LoginResponse, AxiosError<{ error?: AuthErrorCode; hint?: string }>>({
    mutationFn: () => apiLogin({ email, password }),
    onSuccess: (data) => {
      setSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
      void navigate({ to: next ?? '/' });
    },
    onError: (err) => setError(mapAxiosError(err)),
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);

    // Client-side validation via the shared Zod schema. Mirrors what the
    // server will do — surfacing it locally avoids a needless round-trip
    // for obvious mistakes.
    const parsed = loginRequestSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      setError({
        code: 'validation_failed',
        message:
          parsed.error.issues[0]?.message ?? 'Please enter a valid email and password.',
      });
      return;
    }
    mutation.mutate();
  }

  const isSubmitting = mutation.isPending;
  const showHint = error?.code === 'no_user_seeded' && error.hint;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-[360px] space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Focus Tracker</h1>
          <p className="mt-1 text-sm text-neutral-400">Sign in to continue</p>
        </header>

        {showHint && (
          <div
            role="note"
            className="rounded-md border border-amber-900/50 bg-amber-950/40 p-3 text-xs text-amber-200"
          >
            <p className="font-medium">No user account exists yet.</p>
            <p className="mt-1 text-amber-200/80">{error?.hint}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-busy={isSubmitting}>
          <Field
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="username"
            inputMode="email"
            autoFocus
            disabled={isSubmitting}
            invalid={error?.code === 'validation_failed' || error?.code === 'invalid_credentials'}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={isSubmitting}
            invalid={error?.code === 'validation_failed' || error?.code === 'invalid_credentials'}
          />

          {/* Error region — always present so layout doesn't shift. */}
          <div
            id="login-error"
            role="alert"
            aria-live="assertive"
            className={`min-h-[1.25rem] text-sm ${
              error && error.code !== 'no_user_seeded' ? 'text-red-300' : 'text-transparent'
            }`}
          >
            {error && error.code !== 'no_user_seeded' ? error.message : '—'}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:bg-emerald-500/40"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function mapAxiosError(
  err: AxiosError<{ error?: AuthErrorCode; hint?: string }>,
): FormError {
  if (!err.response) {
    return {
      code: 'network',
      message: 'Could not reach the server. Is the API running?',
    };
  }
  const code = err.response.data?.error;
  switch (err.response.status) {
    case 401:
      // §12.1 / §4.1 — constant message regardless of which 401 code fires.
      return { code: 'invalid_credentials', message: 'Invalid email or password.' };
    case 503:
      if (code === 'no_user_seeded') {
        return {
          code: 'no_user_seeded',
          message: 'No user account exists yet.',
          hint: err.response.data?.hint,
        };
      }
      return { code: 'network', message: 'The server is unavailable. Try again shortly.' };
    case 400:
      return {
        code: 'validation_failed',
        message: 'Please enter a valid email and password.',
      };
    default:
      return { code: 'network', message: 'Unexpected error. Try again.' };
  }
}

interface FieldProps {
  id: string;
  label: string;
  type: 'email' | 'password';
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  inputMode?: 'email' | 'text';
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}

function Field(props: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={props.id} className="block text-xs font-medium text-neutral-300">
        {props.label}
      </label>
      <input
        id={props.id}
        name={props.id}
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        aria-invalid={props.invalid ?? false}
        aria-describedby="login-error"
        required
        className={`block w-full rounded-md border bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 ${
          props.invalid
            ? 'border-red-700 focus-visible:ring-red-400'
            : 'border-neutral-700 focus:border-neutral-500'
        }`}
      />
    </div>
  );
}
