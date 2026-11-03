"use client"

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

const compactButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center p-0 cursor-pointer transition-colors outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:bg-transparent disabled:text-text-disabled disabled:border-transparent disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      appearance: {
        stroke: 'border border-input bg-background text-muted-foreground shadow-xs hover:border-transparent hover:bg-muted active:border-transparent active:bg-primary active:text-primary-foreground aria-pressed:border-transparent aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary-hover',
        ghost: 'border border-transparent bg-transparent text-muted-foreground hover:bg-muted active:bg-primary active:text-primary-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary-hover',
        white: 'border border-transparent bg-background text-muted-foreground hover:bg-muted active:bg-primary active:text-primary-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary-hover',
        modifiable: 'border border-transparent bg-transparent text-current hover:bg-current/15 active:border-current active:bg-current/15 aria-pressed:border-current aria-pressed:bg-current/15',
      },
      size: {
        20: "size-5 [&_svg:not([class*='size-'])]:size-4.5",
        24: "size-6 [&_svg:not([class*='size-'])]:size-5",
      },
      fullRadius: {
        true: 'rounded-full',
        false: 'rounded-sm',
      },
    },
    defaultVariants: {
      appearance: 'stroke',
      size: 24,
      fullRadius: false,
    },
  },
)

export type CompactButtonProps = React.ComponentPropsWithoutRef<'button'> &
  VariantProps<typeof compactButtonVariants> & {
    asChild?: boolean
    'aria-label': string
  }

export const CompactButton = React.forwardRef<HTMLButtonElement, CompactButtonProps>(
  ({ className, appearance, size, fullRadius, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : 'button'
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : 'button'}
        data-slot="compact-button"
        className={cn(compactButtonVariants({ appearance, size, fullRadius }), className)}
        {...props}
      />
    )
  },
)

CompactButton.displayName = 'CompactButton'

export { compactButtonVariants }
