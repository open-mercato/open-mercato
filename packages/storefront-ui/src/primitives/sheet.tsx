'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '../lib/cn'
import { XIcon } from '../lib/icons'
import { submitOnModifierEnter } from './dialog'

type Side = 'right' | 'left' | 'bottom'

const sideClass: Record<Side, string> = {
  right: 'inset-2 rounded-sf-sheet border border-border sm:left-auto sm:w-105 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  left: 'inset-2 rounded-sf-sheet border border-border sm:right-auto sm:w-105 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
  bottom: 'inset-x-0 bottom-0 max-h-[92dvh] w-full rounded-t-sf-sheet border-t border-border data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
}

export type SheetContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: Side
  closeLabel?: string
}

const SheetContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(function SheetContent(
  { className, side = 'right', closeLabel, children, onKeyDown, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-overlay bg-foreground/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="sheet"
        data-side={side}
        onKeyDown={(event) => { submitOnModifierEnter(event); onKeyDown?.(event) }}
        className={cn(
          'fixed z-modal flex flex-col overflow-hidden bg-popover text-popover-foreground shadow-xl outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out duration-(--sf-motion-slow)',
          sideClass[side],
          className,
        )}
        {...props}
      >
        {side === 'bottom' ? (
          <div aria-hidden="true" className="flex justify-center pb-1 pt-2.5">
            <span className="h-1 w-10 rounded-full bg-border" />
          </div>
        ) : null}
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

const SheetHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(function SheetHeader({ className, ...props }, ref) {
  return <div ref={ref} data-slot="sheet-header" className={cn('flex flex-col gap-1 px-5 pb-3 pr-14 pt-4', className)} {...props} />
})

const SheetTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  function SheetTitle({ className, ...props }, ref) {
    return <DialogPrimitive.Title ref={ref} className={cn('text-sf-title-sm lg:text-sf-title', className)} {...props} />
  },
)

const SheetDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  function SheetDescription({ className, ...props }, ref) {
    return <DialogPrimitive.Description ref={ref} className={cn('text-sf-body text-muted-foreground', className)} {...props} />
  },
)

const SheetBody = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(function SheetBody({ className, ...props }, ref) {
  return <div ref={ref} data-slot="sheet-body" className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-2', className)} {...props} />
})

const SheetFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(function SheetFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="sheet-footer"
      className={cn('flex flex-col gap-3 border-t border-border bg-popover px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4', className)}
      {...props}
    />
  )
})

// Own root on purpose: Object.assign on the Radix root would mutate an object other primitives share.
function SheetRoot(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />
}

export const Sheet = Object.assign(SheetRoot, {
  Trigger: DialogPrimitive.Trigger,
  Close: DialogPrimitive.Close,
  Content: SheetContent,
  Header: SheetHeader,
  Title: SheetTitle,
  Description: SheetDescription,
  Body: SheetBody,
  Footer: SheetFooter,
})
