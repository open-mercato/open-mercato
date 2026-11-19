'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '../lib/cn'
import { XIcon } from '../lib/icons'

const sizeClass = { sm: 'max-w-100', md: 'max-w-140', lg: 'max-w-180' }

export type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  size?: keyof typeof sizeClass
  /** Accessible name of the close button, resolved by the app's i18n. Omit to hide the button. */
  closeLabel?: string
}

/**
 * Keyboard contract shared by every dialog in the suite: Escape cancels (Radix),
 * Cmd/Ctrl+Enter activates the button marked `data-dialog-primary` inside the content.
 */
function submitOnModifierEnter(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
  const primary = event.currentTarget.querySelector<HTMLButtonElement>('[data-dialog-primary]')
  if (primary && !primary.disabled) {
    event.preventDefault()
    primary.click()
  }
}

const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(function DialogContent(
  { className, size = 'md', closeLabel, children, onKeyDown, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-overlay bg-foreground/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog"
        onKeyDown={(event) => { submitOnModifierEnter(event); onKeyDown?.(event) }}
        className={cn(
          'fixed left-1/2 top-1/2 z-modal flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-sf-card bg-popover text-popover-foreground shadow-xl outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          sizeClass[size],
          className,
        )}
        {...props}
      >
        {children}
        {closeLabel ? (
          <DialogPrimitive.Close className="absolute right-4 top-4 flex size-sf-sm cursor-pointer items-center justify-center rounded-sf-chip bg-sf-surface text-foreground outline-none transition-colors hover:bg-sf-surface-tint focus-visible:shadow-focus [&_svg]:size-5">
            <XIcon />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})

const DialogHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(function DialogHeader({ className, ...props }, ref) {
  return <div ref={ref} data-slot="dialog-header" className={cn('flex flex-col gap-1.5 px-6 pb-2 pr-14 pt-6', className)} {...props} />
})

const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  function DialogTitle({ className, ...props }, ref) {
    return <DialogPrimitive.Title ref={ref} className={cn('text-sf-title-sm lg:text-sf-title', className)} {...props} />
  },
)

const DialogDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  function DialogDescription({ className, ...props }, ref) {
    return <DialogPrimitive.Description ref={ref} className={cn('text-sf-body text-muted-foreground', className)} {...props} />
  },
)

const DialogBody = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(function DialogBody({ className, ...props }, ref) {
  return <div ref={ref} data-slot="dialog-body" className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4', className)} {...props} />
})

export type DialogFooterProps = React.ComponentPropsWithoutRef<'div'> & {
  /** `equal` stretches the buttons 50/50 for confirmations. */
  layout?: 'end' | 'equal' | 'between'
}

const DialogFooter = React.forwardRef<HTMLDivElement, DialogFooterProps>(function DialogFooter({ className, layout = 'end', ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="dialog-footer"
      className={cn(
        'flex gap-3 border-t border-border px-6 py-4',
        layout === 'end' && 'flex-col-reverse sm:flex-row sm:justify-end',
        layout === 'equal' && '[&>*]:flex-1',
        layout === 'between' && 'items-center justify-between',
        className,
      )}
      {...props}
    />
  )
})

// Own root on purpose: Object.assign on the Radix root would mutate an object other primitives share.
function DialogRoot(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />
}

export const Dialog = Object.assign(DialogRoot, {
  Trigger: DialogPrimitive.Trigger,
  Close: DialogPrimitive.Close,
  Content: DialogContent,
  Header: DialogHeader,
  Title: DialogTitle,
  Description: DialogDescription,
  Body: DialogBody,
  Footer: DialogFooter,
})

export { submitOnModifierEnter }
