'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { cn } from '../lib/cn'
import { CheckIcon, MinusIcon } from '../lib/icons'

type Variant = 'box' | 'chip' | 'switch'

export type CheckboxProps = Omit<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, 'children'> & {
  variant?: Variant
  label?: React.ReactNode
  description?: React.ReactNode
  /** Chip only: shown struck through, stays focusable and announces as disabled, never toggles. */
  unavailable?: boolean
  /** Chip only: trailing content such as a count. */
  trailing?: React.ReactNode
}

export const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(function Checkbox(
  { variant = 'box', label, description, unavailable, trailing, className, id, disabled, onCheckedChange, ...props },
  ref,
) {
  const generated = React.useId()
  const controlId = id ?? generated

  if (variant === 'chip') {
    return (
      <CheckboxPrimitive.Root
        ref={ref}
        id={controlId}
        data-slot="checkbox-chip"
        aria-disabled={unavailable || undefined}
        data-unavailable={unavailable ? '' : undefined}
        disabled={disabled}
        onCheckedChange={unavailable ? undefined : onCheckedChange}
        className={cn(
          'inline-flex h-sf-md shrink-0 cursor-pointer select-none items-center gap-2 rounded-sf-chip border border-border bg-background px-4 text-sf-body-sm text-foreground sf-label-case',
          'outline-none transition-colors hover:border-muted-foreground focus-visible:shadow-focus',
          'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
          'data-[unavailable]:cursor-not-allowed data-[unavailable]:border-transparent data-[unavailable]:bg-muted data-[unavailable]:text-muted-foreground data-[unavailable]:line-through',
          'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-bg-disabled disabled:text-text-disabled',
          className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="flex">
          <CheckIcon className="size-4" />
        </CheckboxPrimitive.Indicator>
        {label}
        {trailing ? <span className="text-sf-body-xs font-normal opacity-80">{trailing}</span> : null}
      </CheckboxPrimitive.Root>
    )
  }

  if (variant === 'switch') {
    return (
      <label htmlFor={controlId} className={cn('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed', className)}>
        <CheckboxPrimitive.Root
          ref={ref}
          id={controlId}
          role="switch"
          data-slot="switch"
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          className={cn(
            'relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-input p-0.5 outline-none transition-colors duration-(--sf-motion-base)',
            'focus-visible:shadow-focus data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:bg-border-disabled',
            'after:block after:size-5 after:rounded-full after:bg-background after:shadow-sm after:transition-transform after:duration-(--sf-motion-base) data-[state=checked]:after:translate-x-5',
          )}
          {...props}
        />
        {label || description ? (
          <span className="flex flex-col gap-0.5">
            {label ? <span className="text-sf-body-sm text-foreground">{label}</span> : null}
            {description ? <span className="text-sf-body-xs text-muted-foreground">{description}</span> : null}
          </span>
        ) : null}
      </label>
    )
  }

  const box = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={controlId}
      data-slot="checkbox"
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className={cn(
        'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-input bg-background text-primary-foreground outline-none transition-colors',
        'hover:border-muted-foreground focus-visible:shadow-focus',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-bg-disabled',
        !label && className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex">
        {props.checked === 'indeterminate' ? <MinusIcon className="size-3.5" strokeWidth={3} /> : <CheckIcon className="size-3.5" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
  if (!label) return box
  return (
    <label htmlFor={controlId} className={cn('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed', className)}>
      <span className="flex h-6 items-center">{box}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sf-body-sm text-foreground">{label}</span>
        {description ? <span className="text-sf-body-xs text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  )
})
