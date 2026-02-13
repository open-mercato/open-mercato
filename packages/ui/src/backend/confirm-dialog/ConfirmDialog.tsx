"use client";
import * as React from "react";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { Button } from "@open-mercato/ui/primitives/button";
import { cn } from "@open-mercato/shared/lib/utils";
import { Loader2, X } from "lucide-react";

export type ConfirmDialogProps = {
  /** Whether the dialog is open (controlled mode — used by useConfirmDialog) */
  open?: boolean;
  /** Callback when open state changes (controlled mode) */
  onOpenChange?: (open: boolean) => void;
  /** Callback when user confirms */
  onConfirm: () => void | Promise<void>;
  /** Callback when user cancels (optional, defaults to closing) */
  onCancel?: () => void;
  /** Dialog title. Defaults to i18n key "ui.dialogs.confirm.defaultTitle" ("Are you sure?") */
  title?: string;
  /** Dialog body text / description */
  text?: string;
  /** Confirm button label. Defaults to i18n "ui.dialogs.confirm.confirmText" ("Confirm").
   *  Pass `false` to hide the confirm button entirely. */
  confirmText?: string | false;
  /** Cancel button label. Defaults to i18n "ui.dialogs.confirm.cancelText" ("Cancel").
   *  Pass `false` to hide the cancel button entirely. */
  cancelText?: string | false;
  /** Visual variant — "destructive" renders the confirm button in red */
  variant?: "default" | "destructive";
  /** Whether the confirm button shows a loading spinner.
   *  Useful for async onConfirm handlers (e.g., waiting for API response before closing). */
  loading?: boolean;
  /** Trigger element — when provided, component manages its own open state (declarative mode).
   *  Clicking the trigger opens the dialog. */
  trigger?: React.ReactNode;
};

export function ConfirmDialog({
  open: controlledOpen,
  onOpenChange,
  onConfirm,
  onCancel,
  title,
  text,
  confirmText,
  cancelText,
  variant = "default",
  loading = false,
  trigger,
}: ConfirmDialogProps) {
  const t = useT();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [internalOpen, setInternalOpen] = React.useState(false);
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);

  // Determine if we're in controlled mode (open prop provided) or declarative mode (trigger provided)
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled
    ? onOpenChange || (() => {})
    : setInternalOpen;

  // Default text values from i18n
  const resolvedTitle =
    title ?? t("ui.dialogs.confirm.defaultTitle", "Are you sure?");
  const resolvedConfirmText =
    confirmText === false
      ? false
      : confirmText ?? t("ui.dialogs.confirm.confirmText", "Confirm");
  const resolvedCancelText =
    cancelText === false
      ? false
      : cancelText ?? t("ui.dialogs.confirm.cancelText", "Cancel");
  const closeAriaLabel = t("ui.dialog.close.ariaLabel", "Close");

  // Handle dialog open/close with native showModal/close
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
        // Focus cancel button (safe default) or confirm if no cancel
        setTimeout(() => {
          if (resolvedCancelText !== false && cancelButtonRef.current) {
            cancelButtonRef.current.focus();
          } else if (confirmButtonRef.current) {
            confirmButtonRef.current.focus();
          }
        }, 0);
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [open, resolvedCancelText]);

  // Handle native cancel event (Escape key)
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      // Prevent close if loading
      if (loading) {
        e.preventDefault();
        return;
      }
      setOpen(false);
      onCancel?.();
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [loading, setOpen, onCancel]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    // Only close if clicking directly on the dialog (backdrop), not its children
    if (e.target === dialogRef.current && !loading) {
      setOpen(false);
      onCancel?.();
    }
  };

  // Handle keyboard shortcuts
  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+Enter confirms
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !loading) {
        e.preventDefault();
        handleConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, loading]);

  const handleConfirm = async () => {
    await onConfirm();
    // Don't auto-close if loading — let the parent control when to close
    if (!loading) {
      setOpen(false);
    }
  };

  const handleCancel = () => {
    setOpen(false);
    onCancel?.();
  };

  const handleTriggerClick = () => {
    if (trigger) {
      setOpen(true);
    }
  };

  return (
    <>
      {trigger && (
        <div onClick={handleTriggerClick} className="inline-block">
          {trigger}
        </div>
      )}

      <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={text ? "confirm-dialog-description" : undefined}
        onClick={handleBackdropClick}
        className={cn(
          // Reset dialog defaults
          "m-0 p-0 max-w-none bg-transparent border-none",
          // Backdrop styling
          "backdrop:bg-black/50 backdrop:backdrop-blur-sm backdrop:transition-opacity",
          // Mobile: bottom sheet
          "fixed inset-x-0 bottom-0 w-full",
          // Desktop: centered
          "sm:inset-auto sm:mx-auto sm:my-auto sm:max-w-md sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
          // Animation with reduced motion support
          "motion-safe:open:animate-in motion-safe:open:fade-in-0 motion-safe:open:slide-in-from-bottom-4",
          "sm:motion-safe:open:slide-in-from-bottom-0 sm:motion-safe:open:zoom-in-95",
          // Duration
          "motion-safe:open:duration-300"
        )}
      >
        <div
          role="document"
          className={cn(
            // Panel container
            "flex flex-col gap-4 rounded-t-2xl border-t bg-card p-6 shadow-lg",
            "sm:rounded-xl sm:border",
            // Relative positioning for close button
            "relative"
          )}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            aria-label={closeAriaLabel}
            className={cn(
              "absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity",
              "hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              "disabled:pointer-events-none disabled:opacity-50"
            )}
          >
            <X className="h-4 w-4" />
          </button>

          {/* Title */}
          <h2
            id="confirm-dialog-title"
            className={cn(
              "text-lg font-semibold leading-none tracking-tight pr-6",
              // Mobile: centered, Desktop: left-aligned
              "text-center sm:text-left"
            )}
          >
            {resolvedTitle}
          </h2>

          {/* Description (optional) */}
          {text && (
            <p
              id="confirm-dialog-description"
              className="text-sm text-muted-foreground"
            >
              {text}
            </p>
          )}

          {/* Actions */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {resolvedCancelText !== false && (
              <Button
                ref={cancelButtonRef}
                variant="outline"
                onClick={handleCancel}
                disabled={loading}
                className="w-full sm:w-auto"
              >
                {resolvedCancelText}
              </Button>
            )}
            {resolvedConfirmText !== false && (
              <Button
                ref={confirmButtonRef}
                variant={variant === "destructive" ? "destructive" : "default"}
                onClick={handleConfirm}
                disabled={loading}
                className="w-full sm:w-auto"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {resolvedConfirmText}
              </Button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
