import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Minimal accessible modal primitive. We deliberately don't pull in Radix
// or HeadlessUI for v1 — a single component fills our needs (pair / revoke
// confirmation, future logout-all confirm) without ~20KB of dependency.
//
// Behaviour:
//   - Renders into document.body via portal so it escapes ancestor stacking
//     contexts and overflow:hidden traps.
//   - role="dialog" + aria-modal + aria-labelledby for SR users.
//   - Esc closes (overridable).
//   - Click on backdrop closes (overridable).
//   - Initial focus moves into the dialog on open; on close, focus returns
//     to whatever was focused before open.
//   - Basic focus trap: Tab from last focusable wraps to first, Shift+Tab
//     from first wraps to last.
//   - Body scroll is locked while open so the page behind doesn't scroll.

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /// Optional, longer description rendered immediately under the title.
  description?: string;
  /// Defaults to true. Set false for destructive flows where we want the
  /// user to explicitly click Cancel.
  closeOnBackdropClick?: boolean;
  /// Defaults to true. Set false for the same reason.
  closeOnEsc?: boolean;
  /// Bottom action bar — pass a row of buttons. Optional; some modals
  /// (info-only) don't need one.
  footer?: ReactNode;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal(props: ModalProps) {
  const {
    open,
    onClose,
    title,
    description,
    closeOnBackdropClick = true,
    closeOnEsc = true,
    footer,
    children,
  } = props;
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Lock body scroll + remember focus + restore focus
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog on the next tick so the portal has mounted.
    const id = window.setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? root).focus();
    }, 0);

    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Esc + focus trap
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && closeOnEsc) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('aria-hidden'),
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, closeOnEsc]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      // The backdrop layer — pointer-events go to the wrapper; clicks on
      // the dialog itself stopPropagation below.
      onMouseDown={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/50 focus:outline-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="border-b border-neutral-800 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-neutral-100">
            {title}
          </h2>
          {description && (
            <p id={descId} className="mt-1 text-sm text-neutral-400">
              {description}
            </p>
          )}
        </header>
        <div className="px-5 py-5">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-neutral-800 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
