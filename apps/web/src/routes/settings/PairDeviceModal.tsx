import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { PairingCodeClaimResponse, PairingErrorCode } from '@focus-tracker/shared';
import { Modal } from '../../components/Modal';
import { claimPairingCode, devicesQueryKeys } from '../../lib/devices-api';

// The Pair-new-device modal. Per Settings.md §4.4:
//   - Single 6-digit numeric input.
//   - Web app calls POST /v1/devices/pairing-codes/{code}/claim with JWT.
//   - On 200 the modal closes and the new device gets pulled into the
//     list via query invalidation (parent handles the highlight).
//
// Error mapping mirrors PAIRING_ERROR_CODES — we surface friendly text
// inline rather than as toasts so the user can correct in place.

interface PairDeviceModalProps {
  open: boolean;
  onClose: () => void;
  onPaired: (device: PairingCodeClaimResponse) => void;
}

type FormErrorCode = PairingErrorCode | 'validation_failed' | 'network';

interface FormError {
  code: FormErrorCode;
  message: string;
}

export function PairDeviceModal({ open, onClose, onPaired }: PairDeviceModalProps) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<FormError | null>(null);

  // Reset state every time the modal opens. Otherwise users would see a
  // stale code or error from their previous attempt.
  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation<
    PairingCodeClaimResponse,
    AxiosError<{ error?: PairingErrorCode }>,
    string
  >({
    mutationFn: (c) => claimPairingCode(c),
    onSuccess: (data) => {
      // Refresh the device list so the new row appears.
      void qc.invalidateQueries({ queryKey: devicesQueryKeys.list() });
      onPaired(data);
      onClose();
    },
    onError: (err) => setError(mapClaimError(err)),
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError({
        code: 'validation_failed',
        message: 'Enter the 6-digit code shown by your device.',
      });
      return;
    }
    mutation.mutate(trimmed);
  }

  const isSubmitting = mutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pair a new device"
      description="Open the Focus Tracker extension or desktop app and click 'Pair this device' to get a 6-digit code."
      closeOnBackdropClick={!isSubmitting}
      closeOnEsc={!isSubmitting}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="pair-form"
            disabled={isSubmitting || code.length !== 6}
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-500/40"
          >
            {isSubmitting ? 'Pairing…' : 'Pair'}
          </button>
        </>
      }
    >
      <form id="pair-form" onSubmit={handleSubmit} className="space-y-3" noValidate>
        <label htmlFor="pairing-code" className="block text-xs font-medium text-neutral-300">
          Pairing code
        </label>
        <input
          id="pairing-code"
          name="pairing-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          // Strip non-digits as the user types so paste-with-spaces still works.
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={isSubmitting}
          aria-invalid={error != null}
          aria-describedby="pair-error"
          autoFocus
          className={`block w-full rounded-md border bg-neutral-900 px-3 py-2.5 font-mono text-xl tracking-[0.4em] text-neutral-100 placeholder-neutral-600 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-60 ${
            error ? 'border-red-700 focus-visible:ring-red-400' : 'border-neutral-700 focus:border-neutral-500'
          }`}
          placeholder="000000"
        />
        <div
          id="pair-error"
          role="alert"
          aria-live="assertive"
          className={`min-h-[1.25rem] text-xs ${error ? 'text-red-300' : 'text-transparent'}`}
        >
          {error?.message ?? '—'}
        </div>
      </form>
    </Modal>
  );
}

function mapClaimError(err: AxiosError<{ error?: PairingErrorCode }>): FormError {
  if (!err.response) {
    return {
      code: 'network',
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }
  const code = err.response.data?.error;
  switch (code) {
    case 'pairing_code_invalid':
      return {
        code,
        message:
          "That code wasn't recognized. It may have expired (codes are valid for 5 minutes). Get a fresh code from your device and try again.",
      };
    case 'pairing_code_already_claimed':
      return {
        code,
        message: 'That code has already been used to pair another device.',
      };
    default:
      // Validation failures from the server are extremely unlikely (we
      // restrict to 6 digits client-side) but render whatever the server
      // gave us as the catch-all message.
      return {
        code: 'network',
        message: 'Unexpected error. Try again.',
      };
  }
}
