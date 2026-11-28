'use client'

import * as React from 'react'
import * as RadioPrimitive from '@radix-ui/react-radio-group'
import { cn } from '../lib/cn'

type Variant = 'dot' | 'chip' | 'card'

const VariantContext = React.createContext<Variant>('dot')

export type RadioGroupProps = React.ComponentPropsWithoutRef<typeof RadioPrimitive.Root> & {
  variant?: Variant
}

const RadioGroupRoot = React.forwardRef<React.ElementRef<typeof RadioPrimitive.Root>, RadioGroupProps>(function RadioGroup(
  { variant = 'dot', className, ...props },
  ref,
) {
  return (
    <VariantContext.Provider value={variant}>
      <RadioPrimitive.Root
        ref={ref}
        data-slot="radio-group"
        data-variant={variant}
        className={cn(variant === 'chip' ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2.5', className)}
        {...props}
      />
    </VariantContext.Provider>
  )
})

export type RadioGroupItemProps = Omit<React.ComponentPropsWithoutRef<typeof RadioPrimitive.Item>, 'children'> & {
  label: React.ReactNode
  description?: React.ReactNode
  /** Small badge or tag rendered next to the label (card and dot variants). */
  badge?: React.ReactNode
  /** Right-aligned slot: a price, a logo, a delivery date (card variant). */
  trailing?: React.ReactNode
  /** Out of stock: struck through, stays focusable, announces as disabled, never selects. */
  unavailable?: boolean
  /** Card variant: content revealed when the item is selected (payment form, pickup picker). */
  children?: React.ReactNode
}

const RadioGroupItem = React.forwardRef<React.ElementRef<typeof RadioPrimitive.Item>, RadioGroupItemProps>(function RadioGroupItem(
  { label, description, badge, trailing, unavailable, children, className, onClick, onKeyDown, ...props },
  ref,
) {
  const variant = React.useContext(VariantContext)
  const generated = React.useId()
  const descriptionId = description ? `${generated}-description` : undefined
  const block = (event: React.SyntheticEvent) => {
    if (unavailable) event.preventDefault()
  }
  const shared = {
    ref,
    'aria-disabled': unavailable || undefined,
    'data-unavailable': unavailable ? '' : undefined,
    'aria-describedby': descriptionId,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => { block(event); onClick?.(event) },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => { if (unavailable && (event.key === ' ' || event.key === 'Enter')) event.preventDefault(); onKeyDown?.(event) },
    ...props,
  }

  if (variant === 'chip') {
    return (
      <RadioPrimitive.Item
        data-slot="radio-chip"
        className={cn(
          'inline-flex h-sf-md shrink-0 cursor-pointer select-none items-center gap-2 rounded-sf-chip border border-border bg-background px-4 text-sf-body-sm text-foreground sf-label-case',
          'outline-none transition-colors hover:border-muted-foreground focus-visible:shadow-focus',
          'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
          'data-[unavailable]:cursor-not-allowed data-[unavailable]:border-transparent data-[unavailable]:bg-muted data-[unavailable]:text-muted-foreground data-[unavailable]:line-through',
          'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-bg-disabled disabled:text-text-disabled',
          className,
        )}
        {...shared}
      >
        {label}
        {trailing ? <span className="text-sf-body-xs font-normal opacity-80">{trailing}</span> : null}
        {description ? <span id={descriptionId} className="sr-only">{description}</span> : null}
      </RadioPrimitive.Item>
    )
  }

  const dot = (
    <span
      aria-hidden="true"
      className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-input bg-background transition-colors group-hover:border-muted-foreground group-data-[state=checked]:border-primary group-data-[unavailable]:border-border-disabled group-data-[unavailable]:bg-bg-disabled group-disabled:border-border-disabled group-disabled:bg-bg-disabled"
    >
      <RadioPrimitive.Indicator className="size-2.5 rounded-full bg-primary" />
    </span>
  )

  const text = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2 text-sf-body-sm text-foreground group-data-[unavailable]:text-muted-foreground group-data-[unavailable]:line-through">
        {label}
        {badge}
      </span>
      {description ? <span id={descriptionId} className="text-sf-body-xs text-muted-foreground">{description}</span> : null}
    </span>
  )

  if (variant === 'card') {
    return (
      <RadioPrimitive.Item
        data-slot="radio-card"
        className={cn(
          'group flex w-full cursor-pointer flex-col rounded-sf-field border border-border bg-background text-left outline-none transition-colors',
          'hover:border-muted-foreground focus-visible:shadow-focus',
          'data-[state=checked]:border-foreground data-[state=checked]:ring-1 data-[state=checked]:ring-inset data-[state=checked]:ring-foreground',
          'data-[unavailable]:cursor-not-allowed data-[unavailable]:bg-muted',
          'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-bg-disabled',
          className,
        )}
        {...shared}
      >
        <span className="flex items-start gap-3 p-4">
          {dot}
          {text}
          {trailing ? <span className="shrink-0 text-sf-body-sm text-foreground">{trailing}</span> : null}
        </span>
        {children ? <span className="hidden border-t border-border p-4 text-left group-data-[state=checked]:block">{children}</span> : null}
      </RadioPrimitive.Item>
    )
  }

  return (
    <RadioPrimitive.Item
      data-slot="radio"
      className={cn('group flex cursor-pointer items-start gap-3 text-left outline-none focus-visible:[&>span:first-child]:shadow-focus data-[unavailable]:cursor-not-allowed disabled:cursor-not-allowed', className)}
      {...shared}
    >
      {dot}
      {text}
      {trailing ? <span className="shrink-0 text-sf-body-sm text-foreground">{trailing}</span> : null}
    </RadioPrimitive.Item>
  )
})

export const RadioGroup = Object.assign(RadioGroupRoot, { Item: RadioGroupItem })
