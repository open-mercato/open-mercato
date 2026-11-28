'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'
import { Spinner } from './spinner'

const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap',
    'rounded-sf-button sf-label-case transition-colors duration-(--sf-motion-fast)',
    'outline-none focus-visible:shadow-focus',
    'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-bg-disabled disabled:text-text-disabled disabled:shadow-none',
    'aria-busy:cursor-progress',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4.5',
  ],
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        outline: 'border border-border bg-background text-foreground hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'text-foreground hover:bg-muted',
        link: 'h-auto px-0 text-foreground underline underline-offset-4 hover:text-muted-foreground',
        destructive: 'border border-status-error-border bg-background text-status-error-text hover:bg-status-error-bg',
      },
      size: {
        sm: 'h-sf-sm px-3 text-sf-body-sm',
        default: 'h-sf-md px-4 text-sf-body',
        lg: 'h-sf-lg px-5 text-sf-body',
        icon: 'size-sf-md p-0',
        'icon-sm': 'size-sf-sm p-0 [&_svg:not([class*=size-])]:size-4',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonProps = React.ComponentPropsWithoutRef<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element instead of a <button>, keeping the styles (Radix Slot). */
    asChild?: boolean
    /** Replaces the label with a spinner while keeping the width; the label stays in the DOM for assistive tech. */
    loading?: boolean
    leadingIcon?: React.ReactNode
    trailingIcon?: React.ReactNode
    /** Right-aligned slot, used for a price inside a buy button. */
    trailing?: React.ReactNode
  }

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, fullWidth, asChild = false, loading = false, disabled, leadingIcon, trailingIcon, trailing, children, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button'
  const content = (
    <>
      {leadingIcon}
      {children}
      {trailing ? <span className="ml-auto pl-2 opacity-85">{trailing}</span> : null}
      {trailingIcon}
    </>
  )
  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-loading={loading ? '' : undefined}
      type={asChild ? undefined : type ?? 'button'}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : loading ? (
        <>
          <span className="invisible contents">{content}</span>
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <Spinner size={size === 'sm' || size === 'icon-sm' ? 16 : 20} />
          </span>
        </>
      ) : (
        content
      )}
    </Comp>
  )
})

export { buttonVariants }
