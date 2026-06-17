import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DeviceListItem } from '@focus-tracker/shared';
import { Modal } from '../../components/Modal';
import { devicesQueryKeys, revokeDevice } from '../../lib/devices-api';

// Revoke confirmation per Settings.md §4.4: destructive flow → no
// backdrop-click-to-close, no ESC-while-mutating. On success the list
// is refetched and the row disappears.

interface RevokeDeviceModalProps {
  device: DeviceListItem | null;
  onClose: () => void;
}

export function RevokeDeviceModal({ device, onClose }: RevokeDeviceModalProps) {
  const qc = useQueryClient();

  const mutation = useMutation<void, Error, string>({
    mutationFn: (id) => revokeDevice(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: devicesQueryKeys.list() });
      onClose();
    },
  });

  function handleConfirm(): void {
    if (!device) return;
    mutation.mutate(device.id);
  }

  return (
    <Modal
      open={device != null}
      onClose={onClose}
      title={device ? `Revoke "${device.label}"?` : ''}
      closeOnBackdropClick={!mutation.isPending}
      closeOnEsc={!mutation.isPending}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={mutation.isPending || !device}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-not-allowed disabled:bg-red-600/40"
          >
            {mutation.isPending ? 'Revoking…' : 'Revoke'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-neutral-300">
        <p>
          This device will stop sending data until it is paired again. Historical
          activity already ingested from this device stays in your account.
        </p>
        {mutation.isError && (
          <div
            role="alert"
            className="rounded-md border border-red-900 bg-red-950/40 p-2 text-xs text-red-200"
          >
            Couldn't revoke: {mutation.error.message}
          </div>
        )}
      </div>
    </Modal>
  );
}
