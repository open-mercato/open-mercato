'use client'

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '../lib/cn'

const PopoverContent = React.forwardRef<React.ElementRef<typeof PopoverPrimitive.Content>, React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>>(
  function PopoverContent({ className, align = 'end', sideOffset = 8, ...props }, ref) {
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          data-slot="popover"
          align={align}
          sideOffset={sideOffset}
          className={cn(
            'z-popover w-72 rounded-sf-field border border-border bg-popover p-2 text-popover-foreground shadow-md outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    )
  },
)

/** Vertical list of actions (account menu, row overflow). Items are buttons or links via `asChild`. */
const PopoverMenu = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(function PopoverMenu({ className, ...props }, ref) {
  return <div ref={ref} data-slot="popover-menu" role="group" className={cn('flex flex-col', className)} {...props} />
})

export type PopoverMenuItemProps = React.ComponentPropsWithoutRef<'button'> & {
  icon?: React.ReactNode
  variant?: 'default' | 'destructive'
}

const PopoverMenuItem = React.forwardRef<HTMLButtonElement, PopoverMenuItemProps>(function PopoverMenuItem(
  { className, icon, variant = 'default', children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      data-slot="popover-menu-item"
      className={cn(
        'flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-sf-chip px-3 py-2 text-left text-sf-body-sm text-foreground outline-none transition-colors',
        'hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:text-text-disabled',
        variant === 'destructive' && 'text-status-error-text hover:bg-status-error-bg focus-visible:bg-status-error-bg',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
})

// Own root on purpose: Object.assign on the Radix root would mutate an object other primitives share.
function PopoverRoot(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />
}

export const Popover = Object.assign(PopoverRoot, {
  Trigger: PopoverPrimitive.Trigger,
  Anchor: PopoverPrimitive.Anchor,
  Close: PopoverPrimitive.Close,
  Content: PopoverContent,
  Menu: PopoverMenu,
  MenuItem: PopoverMenuItem,
})
