"use client";
import * as React from "react";
import { ConfirmDialog } from "./ConfirmDialog";

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
  const openRef = React.useRef(false);
  const isDialogElementRenderedRef = React.useRef(false);
  const queueRef = React.useRef<Array<{
    options?: ConfirmDialogOptions;
    resolve: (value: boolean) => void;
  }>>([]);

  const setOpenState = React.useCallback((nextOpen: boolean) => {
    openRef.current = nextOpen;
    setOpen(nextOpen);
  }, []);

  const processQueue = React.useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) return;
    resolveRef.current = next.resolve;
    setOptions(next.options || {});
    setOpenState(true);
  }, [setOpenState]);
  const finalizeInteraction = React.useCallback(() => {
    setOpenState(false);
    processQueue();
  }, [processQueue, setOpenState]);

  const confirm = React.useCallback(
    (newOptions?: ConfirmDialogOptions): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        // Development-mode guard: warn if dialog element is not mounted
        if (
          process.env.NODE_ENV === "development" &&
          !isDialogElementRenderedRef.current
        ) {
          console.warn(
            "useConfirmDialog: confirm() was called but ConfirmDialogElement is not rendered. Add {ConfirmDialogElement} to your JSX."
          );
        }

        // If dialog is already open, queue this request
        if (openRef.current || resolveRef.current) {
          queueRef.current.push({ options: newOptions, resolve });
          return;
        }

        // Otherwise, show the dialog immediately
        resolveRef.current = resolve;
        setOptions(newOptions || {});
        setOpenState(true);
      });
    },
    [setOpenState]
  );

  const handleConfirm = React.useCallback(async () => {
    setLoading(true);
    try {
      // Resolve with true (confirmed)
      resolveRef.current?.(true);
      resolveRef.current = null;
    } finally {
      setLoading(false);
      finalizeInteraction();
    }
  }, [finalizeInteraction]);

  const handleCancel = React.useCallback(() => {
    // Resolve with false (cancelled)
    resolveRef.current?.(false);
    resolveRef.current = null;
    finalizeInteraction();
  }, [finalizeInteraction]);

  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      if (!newOpen && openRef.current) {
        handleCancel();
      }
    },
    [handleCancel]
  );

  const DialogMountTracker = React.useCallback(() => {
    React.useEffect(() => {
      isDialogElementRenderedRef.current = true;
      return () => {
        isDialogElementRenderedRef.current = false;
      };
    }, []);
    return null;
  }, []);

  const ConfirmDialogElement = React.useMemo(
    () => (
      <>
        <DialogMountTracker />
        <ConfirmDialog
          open={open}
          onOpenChange={handleOpenChange}
          onConfirm={handleConfirm}
          title={options.title}
          text={options.text}
          confirmText={options.confirmText}
          cancelText={options.cancelText}
          variant={options.variant}
          loading={loading}
        />
      </>
    ),
    [
      open,
      handleOpenChange,
      handleConfirm,
      options,
      loading,
      DialogMountTracker,
    ]
  );

  return {
    confirm,
    ConfirmDialogElement,
  };
}
