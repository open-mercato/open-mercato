"use client"

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Side-sheet primitive — slides in from `right` (default), `left`,
 * `top`, or `bottom`. Distinct from `Dialog`:
 *
 *   `Drawer`  — contextual / non-blocking-feeling. Used for detail
 *               panes, secondary forms, mobile menus. The user can
 *               glance at it while the surrounding page stays visible
 *               at a glance behind the overlay.
 *   `Dialog`  — modal / focused. Used for confirmations, critical
 *               forms, and full-content workflows that should fully
 *               replace the page underneath.
 *
 * Built on `@radix-ui/react-dialog` (already installed via the
 * `Dialog` primitive — no new dep). Inherits the Dialog ARIA
 * contract (role="dialog", aria-modal, focus trap, ESC to close,
 * outside-click to dismiss).
 *
 * No dedicated Figma node in the DS Open Mercato library at the time
 * this primitive was authored — `Modal Overlay [1.1]` covers the
 * overlay surface, but side-positioned variants aren't shipped. Per
 * R4 in the v5 spec the visual styling is inferred from DS tokens
 * (bg-background, border-input, shadow-lg, rounded-lg for the inner
 * corners only — outer edges stay flush against the viewport).
 *
 * ```tsx
 * const [open, setOpen] = React.useState(false)
 * <Drawer open={open} onOpenChange={setOpen} side="right">
 *   <DrawerTrigger asChild>
 *     <Button>Open drawer</Button>
 *   </DrawerTrigger>
 *   <DrawerContent>
 *     <DrawerHeader>
 *       <DrawerTitle>Edit person</DrawerTitle>
 *       <DrawerDescription>Update the person's contact info.</DrawerDescription>
 *     </DrawerHeader>
 *     <DrawerBody>{children}</DrawerBody>
 *     <DrawerFooter>
 *       <DrawerClose asChild>
 *         <Button variant="ghost">Cancel</Button>
 *       </DrawerClose>
 *       <Button>Save</Button>
 *     </DrawerFooter>
 *   </DrawerContent>
 * </Drawer>
 * ```
 */

const Drawer = DialogPrimitive.Root
const DrawerTrigger = DialogPrimitive.Trigger
const DrawerPortal = DialogPrimitive.Portal
const DrawerClose = DialogPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="drawer-overlay"
    className={cn(
      'fixed inset-0 z-overlay bg-foreground/40 backdrop-blur-sm',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
      className,
    )}
    {...props}
  />
))
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName

const drawerContentVariants = cva(
  // Base layout — fixed position, flex column so DrawerHeader / Body
  // / Footer compose vertically with the body filling free space.
  // Outer border on the panel-facing edge keeps the seam visible
  // against the overlay; the page-facing edge stays flush.
  'fixed z-popover flex flex-col gap-0 bg-background shadow-lg outline-none ' +
    'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
    'data-[state=open]:duration-200 data-[state=closed]:duration-150',
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 h-full w-full max-w-md border-l border-input ' +
          'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        left:
          'inset-y-0 left-0 h-full w-full max-w-md border-r border-input ' +
          'data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        top:
          'inset-x-0 top-0 max-h-[80vh] w-full border-b border-input ' +
          'data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
        bottom:
          'inset-x-0 bottom-0 max-h-[80vh] w-full border-t border-input ' +
          'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
      },
    },
    defaultVariants: { side: 'right' },
  },
)

export type DrawerContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> &
  VariantProps<typeof drawerContentVariants> & {
    /** Hide the default top-right close button. */
    hideCloseButton?: boolean
    /** ARIA label for the auto-rendered close button. Default `"Close"`. */
    closeAriaLabel?: string
  }

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(
  (
    {
      className,
      side,
      children,
      hideCloseButton = false,
      closeAriaLabel = 'Close',
      ...props
    },
    ref,
  ) => (
    <DrawerPortal>
      <DrawerOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="drawer-content"
        data-side={side ?? 'right'}
        className={cn(drawerContentVariants({ side }), className)}
        {...props}
      >
        {children}
        {!hideCloseButton ? (
          <DrawerClose
            data-slot="drawer-close-button"
            aria-label={closeAriaLabel}
            className={cn(
              'absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors',
              'hover:bg-muted/40 hover:text-foreground',
              'focus-visible:shadow-focus',
            )}
          >
            <X aria-hidden="true" className="size-4" />
          </DrawerClose>
        ) : null}
      </DialogPrimitive.Content>
    </DrawerPortal>
  ),
)
DrawerContent.displayName = 'DrawerContent'

const DrawerHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="drawer-header"
      className={cn(
        'flex flex-col gap-1 border-b border-input px-6 py-4 pr-12',
        className,
      )}
      {...props}
    />
  ),
)
DrawerHeader.displayName = 'DrawerHeader'

const DrawerBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="drawer-body"
      className={cn('flex-1 overflow-y-auto px-6 py-4', className)}
      {...props}
    />
  ),
)
DrawerBody.displayName = 'DrawerBody'

const DrawerFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="drawer-footer"
      className={cn(
        'flex flex-row items-center justify-end gap-2 border-t border-input px-6 py-4',
        className,
      )}
      {...props}
    />
  ),
)
DrawerFooter.displayName = 'DrawerFooter'

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="drawer-title"
    className={cn('text-base font-semibold leading-tight text-foreground', className)}
    {...props}
  />
))
DrawerTitle.displayName = DialogPrimitive.Title.displayName

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="drawer-description"
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
DrawerDescription.displayName = DialogPrimitive.Description.displayName

export {
  Drawer,
  DrawerTrigger,
  DrawerPortal,
  DrawerClose,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  drawerContentVariants,
}
