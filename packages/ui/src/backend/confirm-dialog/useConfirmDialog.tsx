"use client";
import * as React from "react";
import { ConfirmDialog } from "./ConfirmDialog";

function DialogMountTracker({ trackerRef }: { trackerRef: React.MutableRefObject<boolean> }) {
  React.useEffect(() => {
    trackerRef.current = true;
    return () => {
      trackerRef.current = false;
    };
  }, [trackerRef]);
  return null;
}

export type ConfirmDialogOptions = {
  title?: string;
  text?: string;
  description?: string;
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

  const processQueue = React.useCallback(() => {
    if (openRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    // Reserve the open slot synchronously so a confirm() call dispatched
    // between this microtask scheduling and the actual setState cannot
    // race ahead and double-open the dialog.
    openRef.current = true;
    resolveRef.current = next.resolve;
    // Defer the React state writes to a microtask so they run after any
    // parent component's useInsertionEffect commit phase (Radix Dialog,
    // CSS-in-JS layer injection, etc.). React 18/19 rejects setState
    // scheduled during the insertion-effect phase with the warning
    // "useInsertionEffect must not schedule updates" — see #1810.
    queueMicrotask(() => {
      setOptions(next.options || {});
      setOpen(true);
    });
  }, []);
  const finalizeInteraction = React.useCallback(() => {
    // Reset openRef BEFORE scheduling queue work so a subsequent confirm()
    // call from the parent's onOpenChange propagation isn't dropped by the
    // openRef.current === true guard (#1804). The visible dialog still
    // closes via setOpen(false); only the internal lock flips early.
    openRef.current = false;
    setOpen(false);
    // Defer queue advancement to the next microtask so the parent's
    // onOpenChange / Promise resolution has a chance to propagate before
    // a queued request reopens the dialog with new options.
    queueMicrotask(() => {
      processQueue();
    });
  }, [processQueue]);

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

        // If dialog is already open or a previous interaction is still
        // resolving, enqueue this request. processQueue() picks it up after
        // the in-flight interaction finalises.
        if (openRef.current || resolveRef.current) {
          queueRef.current.push({ options: newOptions, resolve });
          return;
        }

        // Otherwise, claim the open slot synchronously and defer the
        // actual setState writes to a microtask (same rationale as
        // processQueue — keeps us out of the parent's insertion-effect
        // commit phase).
        openRef.current = true;
        resolveRef.current = resolve;
        queueMicrotask(() => {
          setOptions(newOptions || {});
          setOpen(true);
        });
      });
    },
    []
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

  const ConfirmDialogElement = React.useMemo(
    () => (
      <>
        <DialogMountTracker trackerRef={isDialogElementRenderedRef} />
        <ConfirmDialog
          open={open}
          onOpenChange={handleOpenChange}
          onConfirm={handleConfirm}
          title={options.title}
          text={options.text ?? options.description}
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
    ]
  );

  return {
    confirm,
    ConfirmDialogElement,
  };
}
