import { useCallback, useRef, useState } from 'react';

import { m } from '@/paraglide/messages.js';
import { ConfirmDialog } from '@/components/confirm-dialog';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

// Promise-based replacement for window.confirm, rendered with the app's
// Dialog. Render `dialog` once in the component, then
// `if (!(await confirm({ title }))) return;`.
export function useConfirm() {
  const [open, setOpen] = useState(false);
  // Kept after closing so the text doesn't blank out mid close-animation.
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    resolveRef.current?.(false);
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = (ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setOpen(false);
  };

  const dialog = (
    <ConfirmDialog
      open={open}
      title={options?.title ?? ''}
      description={options?.description}
      confirmLabel={options?.confirmLabel ?? m['common.confirm.ok']()}
      cancelLabel={options?.cancelLabel ?? m['common.confirm.cancel']()}
      destructive={options?.destructive}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, dialog };
}
