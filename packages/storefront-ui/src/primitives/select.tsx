'use client'

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { cn } from '../lib/cn'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from '../lib/icons'

const sizeClass = { sm: 'h-sf-sm text-sf-body-sm', default: 'h-sf-md text-sf-body', lg: 'h-sf-lg text-sf-body' }

export type SelectTriggerProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
  size?: keyof typeof sizeClass
  invalid?: boolean
}

const SelectTrigger = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, SelectTriggerProps>(function SelectTrigger(
  { className, size = 'default', invalid, children, ...props },
  ref,
) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      data-slot="select-trigger"
      aria-invalid={invalid || undefined}
      className={cn(
        'flex w-full min-w-0 cursor-pointer items-center justify-between gap-3 rounded-sf-field border border-input bg-background px-4 text-left text-foreground',
        'outline-none transition-colors hover:border-muted-foreground focus-visible:border-foreground focus-visible:shadow-focus',
        'data-[placeholder]:text-muted-foreground aria-invalid:border-status-error-icon',
        'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-bg-disabled disabled:text-text-disabled',
        '[&>span]:truncate',
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
})

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = 'popper', ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        data-slot="select-content"
        position={position}
        sideOffset={6}
        className={cn(
          'z-popover max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-sf-field border border-border bg-popover text-popover-foreground shadow-md',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center text-muted-foreground"><ChevronUpIcon className="size-4" /></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center text-muted-foreground"><ChevronDownIcon className="size-4" /></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
})

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & { description?: React.ReactNode }
>(function SelectItem({ className, children, description, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      data-slot="select-item"
      className={cn(
        'relative flex min-h-11 w-full cursor-pointer select-none items-center gap-3 rounded-sf-chip py-2.5 pl-3 pr-10 text-sf-body text-foreground outline-none',
        'data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:text-text-disabled',
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 flex-col">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description ? <span className="text-sf-body-xs font-normal text-muted-foreground">{description}</span> : null}
      </span>
      <SelectPrimitive.ItemIndicator className="absolute right-3 flex items-center">
        <CheckIcon className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
})

const SelectLabel = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Label>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>>(
  function SelectLabel({ className, ...props }, ref) {
    return <SelectPrimitive.Label ref={ref} className={cn('px-3 py-2 text-sf-body-xs text-muted-foreground', className)} {...props} />
  },
)

const SelectSeparator = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>>(
  function SelectSeparator({ className, ...props }, ref) {
    return <SelectPrimitive.Separator ref={ref} className={cn('my-1.5 h-px bg-border', className)} {...props} />
  },
)

// Own root on purpose: Object.assign on the Radix root would mutate an object other primitives share.
function SelectRoot(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} />
}

export const Select = Object.assign(SelectRoot, {
  Trigger: SelectTrigger,
  Value: SelectPrimitive.Value,
  Content: SelectContent,
  Item: SelectItem,
  Group: SelectPrimitive.Group,
  Label: SelectLabel,
  Separator: SelectSeparator,
})
