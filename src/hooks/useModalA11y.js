import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Escape closes, Tab stays inside the dialog, and focus returns to the opener on close.
// onClose is read through a ref so parents may pass a fresh arrow function every render
// without re-running the effect (which would steal focus back to the first control).
export default function useModalA11y(dialogRef, onClose, { canClose = true } = {}) {
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  onCloseRef.current = onClose;
  canCloseRef.current = canClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])
      .filter(element => element.offsetParent !== null || element === document.activeElement);
    const initial = dialogRef.current?.querySelector('[data-autofocus]') || focusable()[0];
    initial?.focus();

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        if (!canCloseRef.current) return;
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements.at(-1);
      const inside = dialogRef.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [dialogRef]);
}
