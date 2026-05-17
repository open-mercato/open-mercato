"use client"

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Modal dialog primitive. Phase B.7 rewrite per Figma `Modals` page
 * (`466:4630`) — `Modal Header [1.1]` (`466:4778`, title + optional
 * leading icon badge + optional description), `Modal Footer [1.1]`
 * (`472:566`, right-aligned buttons or 50/50 stretched layout),
 * `Status Modals [1.1]` (`480:1372`, status-icon hero variant).
 *
 * Backward compatibility (40 import sites — every dialog in the
 * product). All existing exports (`Dialog`, `DialogTrigger`,
 * `DialogPortal`, `DialogOverlay`, `DialogClose`, `DialogContent`,
 * `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`)
 * stay callable verbatim. Default `size="default"` reproduces the
 * original `sm:max-w-lg` width; default header has no leading badge;
 * default footer is right-aligned (current look).
 *
 * New (additive):
 *   DialogContent:
 *     - `size: 'sm' | 'default' | 'lg' | 'xl'` — max-width breakpoints
 *     - `dismissible: boolean` (default `true`) — render the auto X
 *       top-right close button
 *
 *   DialogHeader:
 *     - `leading?: ReactNode` — `size-10 rounded-full border` icon
 *       badge to the left of the title block (matches Figma `Modal
 *       Header [1.1]` icon-prefixed variants — same chrome as the
 *       Drawer header leading slot)
 *
 *   DialogFooter:
 *     - `layout: 'default' | 'equal'` (default `default`) — `equal`
 *       stretches children flex-1 for 50/50 confirmation footers
 *       (Figma `Modal Footer [1.1]` variant 1)
 */

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
    /** Render above popovers (z-modal-elevated, 55) instead of the default z-modal (40).
     *  Use when this dialog is opened from inside a popover so it isn't occluded. */
    elevated?: boolean
  }
>(({ className, elevated, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    className={cn(
      'fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity data-[state=open]:animate-in data-[state=closed]:animate-out',
      elevated ? 'z-modal-elevated' : 'z-modal',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const dialogContentVariants = cva(
  'fixed inset-x-0 bottom-0 flex min-h-[50vh] max-h-[70vh] w-full translate-x-0 translate-y-0 flex-col gap-4 overflow-y-auto rounded-t-2xl border-t bg-card p-6 shadow-lg sm:inset-auto sm:left-1/2 sm:top-1/2 sm:min-h-0 sm:h-auto sm:w-full sm:max-h-[90vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border focus-visible:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out',
  {
    variants: {
      size: {
        sm: 'sm:max-w-sm',
        default: 'sm:max-w-lg',
        lg: 'sm:max-w-2xl',
        xl: 'sm:max-w-4xl',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

export type DialogContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> &
  VariantProps<typeof dialogContentVariants> & {
    /** Render above popovers (z-modal-elevated, 55) instead of the default z-modal (40).
     *  Set on dialogs that open from inside another popover (e.g. the SaveFilterDialog
     *  inside the AdvancedFilterPanel popover) so they aren't hidden behind the popover. */
    elevated?: boolean
    /** Render the auto X top-right close button. @default true */
    dismissible?: boolean
    /** Aria label for the auto X close button. Defaults to the
     * `ui.dialog.close.ariaLabel` translation (`"Close"`). */
    closeAriaLabel?: string
  }

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      children,
      elevated,
      size,
      dismissible = true,
      closeAriaLabel,
      ...props
    },
    ref,
  ) => {
    const t = useT()

    React.useEffect(() => {
      return () => {
        if (typeof window === 'undefined') return
        window.setTimeout(() => {
          if (document.querySelector('[data-dialog-content][data-state="open"]')) return
          document.body.style.removeProperty('overflow')
          document.body.style.removeProperty('pointer-events')
        }, 0)
      }
    }, [])

    return (
      <DialogPortal>
        <DialogOverlay elevated={elevated} />
        <DialogPrimitive.Content
          ref={ref}
          data-dialog-content=""
          data-slot="dialog-content"
          data-size={size ?? 'default'}
          className={cn(
            dialogContentVariants({ size }),
            elevated ? 'z-modal-elevated' : 'z-modal',
            className,
          )}
          {...props}
        >
          {dismissible ? (
            <DialogClose
              data-dialog-close=""
              data-slot="dialog-close-button"
              className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={closeAriaLabel ?? t('ui.dialog.close.ariaLabel', 'Close')}
            >
              <X className="h-4 w-4" />
            </DialogClose>
          ) : null}
          {children}
        </DialogPrimitive.Content>
      </DialogPortal>
    )
  },
)
DialogContent.displayName = DialogPrimitive.Content.displayName

export type DialogHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Optional leading icon — rendered inside a size-10 rounded-full
   * bordered badge to the left of the title block. Matches Figma
   * `Modal Header [1.1]` icon-prefixed variants. */
  leading?: React.ReactNode
}

const DialogHeader = ({ className, leading, children, ...props }: DialogHeaderProps) => (
  <div
    data-slot="dialog-header"
    className={cn(
      leading ? 'flex items-start gap-3 text-left' : 'flex flex-col space-y-1.5 text-center sm:text-left',
      className,
    )}
    {...props}
  >
    {leading ? (
      <span
        data-slot="dialog-header-leading"
        aria-hidden="true"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-input bg-background text-muted-foreground"
      >
        {leading}
      </span>
    ) : null}
    {leading ? (
      <div
        data-slot="dialog-header-text"
        className="flex min-w-0 flex-1 flex-col gap-1 text-left"
      >
        {children}
      </div>
    ) : (
      children
    )}
  </div>
)
DialogHeader.displayName = 'DialogHeader'

export type DialogFooterProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Footer layout. `default` reproduces the original
   * `flex flex-col-reverse gap-2 sm:flex-row sm:justify-end` look.
   * `equal` stretches children flex-1 for 50/50 confirmation footers
   * per Figma `Modal Footer [1.1]` variant 1. */
  layout?: 'default' | 'equal'
}

const DialogFooter = ({ className, layout = 'default', ...props }: DialogFooterProps) => (
  <div
    data-slot="dialog-footer"
    data-layout={layout}
    className={cn(
      layout === 'equal'
        ? 'flex flex-row gap-2 [&>*]:flex-1'
        : 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
      className,
    )}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="dialog-title"
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="dialog-description"
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
