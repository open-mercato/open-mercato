"use client";
import * as React from "react";
import { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";

export type ConfirmDialogOptions = {
  title?: string;
  text?: string;
  confirmText?: string | false;
  cancelText?: string | false;
  variant?: "default" | "destructive";
};

export type UseConfirmDialogReturn = {
  /** Call this to show a confirmation dialog. Resolves `true` if confirmed, `false` if cancelled. */
  confirm: (options?: ConfirmDialogOptions) => Promise<boolean>;
  /** Render this in your component tree (renders the <dialog> element) */
  ConfirmDialogElement: React.ReactNode;
};

export function useConfirmDialog(): UseConfirmDialogReturn {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmDialogOptions>({});
  const [loading, setLoading] = React.useState(false);
  const resolveRef = React.useRef<((value: boolean) => void) | null>(null);
  const isMountedRef = React.useRef(false);
  const queueRef = React.useRef<Array<{
    options?: ConfirmDialogOptions;
    resolve: (value: boolean) => void;
  }>>([]);

  // Track if the dialog element has been mounted
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const confirm = React.useCallback(
    (newOptions?: ConfirmDialogOptions): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        // Development-mode guard: warn if dialog element is not mounted
        if (process.env.NODE_ENV === "development" && !isMountedRef.current) {
          console.warn(
            "useConfirmDialog: confirm() was called but ConfirmDialogElement is not rendered. Add {ConfirmDialogElement} to your JSX."
          );
        }

        // If dialog is already open, queue this request
        if (open) {
          queueRef.current.push({ options: newOptions, resolve });
          return;
        }

        // Otherwise, show the dialog immediately
        setOptions(newOptions || {});
        setOpen(true);
        resolveRef.current = resolve;
      });
    },
    [open]
  );

  const handleConfirm = React.useCallback(async () => {
    setLoading(true);
    try {
      // Resolve with true (confirmed)
      resolveRef.current?.(true);
      resolveRef.current = null;
    } finally {
      setLoading(false);
      setOpen(false);

      // Process queue if there are pending requests
      if (queueRef.current.length > 0) {
        const next = queueRef.current.shift();
        if (next) {
          setOptions(next.options || {});
          setOpen(true);
          resolveRef.current = next.resolve;
        }
      }
    }
  }, []);

  const handleCancel = React.useCallback(() => {
    // Resolve with false (cancelled)
    resolveRef.current?.(false);
    resolveRef.current = null;
    setOpen(false);

    // Process queue if there are pending requests
    if (queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (next) {
        setOptions(next.options || {});
        setOpen(true);
        resolveRef.current = next.resolve;
      }
    }
  }, []);

  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        handleCancel();
      }
    },
    [handleCancel]
  );

  const ConfirmDialogElement = React.useMemo(
    () => (
      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        title={options.title}
        text={options.text}
        confirmText={options.confirmText}
        cancelText={options.cancelText}
        variant={options.variant}
        loading={loading}
      />
    ),
    [
      open,
      handleOpenChange,
      handleConfirm,
      handleCancel,
      options,
      loading,
    ]
  );

  return {
    confirm,
    ConfirmDialogElement,
  };
}
