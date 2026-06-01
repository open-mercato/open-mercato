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
 * Built on `@radix-ui/react-dialog` (Radix Dialog under the hood —
 * inherits role="dialog", aria-modal, focus trap, ESC to close,
 * outside-click to dismiss).
 *
 * Figma source: DS Open Mercato `Drawer` page (`486:7366`) —
 * `Drawer Header [1.1]` (`3187:2897`) covers 4 header variants
 * (title only / title + leading icon / title + description /
 * title + description + leading icon badge); `Drawer Footer [1.1]`
 * (`4096:21416`) covers 6 footer variants (50/50 stretched, right-
 * aligned compact, left checkbox + right buttons, left switch +
 * right buttons, left step dots + right buttons, left link button +
 * right buttons). Per the Figma examples the panel has rounded
 * corners on the inner (viewport-facing) edges only, no border on
 * the seam, and no chrome-level dividers between header / body /
 * footer (separators inside the body come from content, not the
 * Drawer).
 *
 * ```tsx
 * const [open, setOpen] = React.useState(false)
 * <Drawer open={open} onOpenChange={setOpen} side="right">
 *   <DrawerTrigger asChild>
 *     <Button>Open drawer</Button>
 *   </DrawerTrigger>
 *   <DrawerContent>
 *     <DrawerHeader leading={<Clock />}>
 *       <DrawerTitle>Edit person</DrawerTitle>
 *       <DrawerDescription>Update the person's contact info.</DrawerDescription>
 *     </DrawerHeader>
 *     <DrawerBody>{children}</DrawerBody>
 *     <DrawerFooter layout="equal">
 *       <DrawerClose asChild>
 *         <Button variant="outline">Cancel</Button>
 *       </DrawerClose>
 *       <Button>Continue</Button>
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
  // Per Figma the panel has rounded corners on the inner (viewport-
  // facing) edges only, no border on the seam, and a generous shadow.
  'fixed z-popover flex flex-col gap-0 bg-background shadow-2xl outline-none ' +
    'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
    'data-[state=open]:duration-200 data-[state=closed]:duration-150',
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 h-full w-full max-w-md rounded-l-xl ' +
          'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        left:
          'inset-y-0 left-0 h-full w-full max-w-md rounded-r-xl ' +
          'data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        top:
          'inset-x-0 top-0 max-h-[80vh] w-full rounded-b-xl ' +
          'data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
        bottom:
          'inset-x-0 bottom-0 max-h-[80vh] w-full rounded-t-xl ' +
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

export type DrawerHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  /**
   * Optional leading icon — rendered inside a size-10 bordered circle
   * badge to the left of the title block. Matches Figma `Drawer Header
   * [1.1]` variants 2 + 4 (icon-prefixed title). Pass a `lucide-react`
   * icon element (size-4 recommended) or any inline node.
   */
  leading?: React.ReactNode
}

const DrawerHeader = React.forwardRef<HTMLDivElement, DrawerHeaderProps>(
  ({ className, leading, children, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="drawer-header"
      className={cn(
        // Per Figma: no chrome border below the header. Padding-right
        // reserves room for the auto-close button at top-right.
        'flex items-start gap-3 px-6 pt-5 pb-4 pr-14',
        className,
      )}
      {...props}
    >
      {leading ? (
        <span
          data-slot="drawer-header-leading"
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-input bg-background text-muted-foreground"
        >
          {leading}
        </span>
      ) : null}
      <div data-slot="drawer-header-text" className="flex min-w-0 flex-1 flex-col gap-1">
        {children}
      </div>
    </div>
  ),
)
DrawerHeader.displayName = 'DrawerHeader'

const DrawerBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="drawer-body"
      className={cn('flex-1 overflow-y-auto px-6 py-2', className)}
      {...props}
    />
  ),
)
DrawerBody.displayName = 'DrawerBody'

export type DrawerFooterProps = React.HTMLAttributes<HTMLDivElement> & {
  /**
   * Footer button layout per Figma `Drawer Footer [1.1]`:
   *   `default` — right-aligned compact buttons (Cancel + Continue).
   *   `equal`   — children stretched to share the row equally (50/50
   *               for two children). Matches Figma variant 1.
   * @default 'default'
   */
  layout?: 'default' | 'equal'
  /**
   * Optional left-side slot — checkbox ("Don't show again"), switch
   * ("Remember me"), step-indicator dots, link button, or any leading
   * content per Figma footer variants 3–6. When provided, children
   * stay right-aligned and the leading slot anchors left.
   * Mutually exclusive with `layout="equal"` (Figma never combines
   * the two — the 50/50 split is a confirmation-flow shape).
   */
  leading?: React.ReactNode
}

const DrawerFooter = React.forwardRef<HTMLDivElement, DrawerFooterProps>(
  ({ className, layout = 'default', leading, children, ...props }, ref) => {
    const childArray = React.Children.toArray(children)
    if (layout === 'equal') {
      return (
        <div
          ref={ref}
          data-slot="drawer-footer"
          data-layout="equal"
          className={cn(
            // Per Figma: no chrome top-border separator; equal-stretch
            // children share the row (50/50 for two buttons).
            'flex flex-row items-center gap-3 px-6 pt-4 pb-5 [&>*]:flex-1',
            className,
          )}
          {...props}
        >
          {childArray}
        </div>
      )
    }
    return (
      <div
        ref={ref}
        data-slot="drawer-footer"
        data-layout="default"
        className={cn(
          // Per Figma: no chrome top-border. Optional `leading` anchors
          // left (mr-auto sibling), buttons stay right-aligned.
          'flex flex-row items-center gap-3 px-6 pt-4 pb-5',
          className,
        )}
        {...props}
      >
        {leading ? (
          <div
            data-slot="drawer-footer-leading"
            className="mr-auto inline-flex items-center gap-2"
          >
            {leading}
          </div>
        ) : null}
        {childArray.length > 0 ? (
          <div
            data-slot="drawer-footer-trailing"
            className={cn(
              'inline-flex items-center gap-3',
              leading ? '' : 'ml-auto',
            )}
          >
            {childArray}
          </div>
        ) : null}
      </div>
    )
  },
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
