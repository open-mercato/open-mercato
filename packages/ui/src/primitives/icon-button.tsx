import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

const iconButtonVariants = cva(
  "inline-flex items-center justify-center cursor-pointer transition-all outline-none disabled:pointer-events-none disabled:bg-bg-disabled disabled:text-text-disabled disabled:border-border-disabled disabled:shadow-none [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:shadow-focus aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary-hover",
  {
    variants: {
      variant: {
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        white:
          'bg-background text-muted-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
        modifiable:
          'bg-transparent text-current hover:bg-foreground/10',
      },
      size: {
        xs: 'size-6',
        sm: 'size-7',
        default: 'size-8',
        lg: 'size-9',
      },
      fullRadius: {
        true: 'rounded-full',
        false: 'rounded-md',
      },
    },
    defaultVariants: {
      variant: 'outline',
      size: 'default',
      fullRadius: false,
    },
  }
)

export function IconButton({
  className,
  variant,
  size,
  fullRadius,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof iconButtonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="icon-button"
      type={asChild ? undefined : 'button'}
      className={cn(iconButtonVariants({ variant, size, fullRadius, className }))}
      {...props}
    />
  )
}

export { iconButtonVariants }
