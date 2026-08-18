import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

const iconButtonVariants = cva(
  // The pressed surface is repeated under `dark:` on purpose: the outline and
  // ghost variants ship `dark:bg-input/30` / `dark:hover:bg-accent/50`, which
  // otherwise outrank the un-prefixed `aria-pressed:` background while the
  // `aria-pressed:text-primary-foreground` still applies — leaving a dark icon
  // on a dark surface (invisible pressed star/bell buttons on the dark theme).
  //
  // Every pressed rule is additionally gated on `enabled:` because a toggle can
  // be pressed AND disabled at the same time (an active editor tool while the
  // document is read-only). Without the gate the pressed rules outrank the
  // `disabled:` surface — `dark:aria-pressed:bg-primary` is more specific than
  // `disabled:bg-bg-disabled` — and a control the user cannot operate renders
  // as a primary, actionable button.
  "inline-flex items-center justify-center cursor-pointer transition-all outline-none disabled:pointer-events-none disabled:bg-bg-disabled disabled:text-text-disabled disabled:border-border-disabled disabled:shadow-none [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:shadow-focus enabled:aria-pressed:bg-primary enabled:aria-pressed:text-primary-foreground enabled:aria-pressed:hover:bg-primary-hover dark:enabled:aria-pressed:bg-primary dark:enabled:aria-pressed:hover:bg-primary-hover",
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
        destructive:
          'bg-destructive text-white shadow-xs hover:bg-destructive/90',
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
