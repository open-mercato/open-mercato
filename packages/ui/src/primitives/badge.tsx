import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
        outline: 'text-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        success: 'border-status-success-border bg-status-success-bg text-status-success-text',
        warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
        info: 'border-status-info-border bg-status-info-bg text-status-info-text',
        neutral: 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-text',
        error: 'border-status-error-border bg-status-error-bg text-status-error-text',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
))

Badge.displayName = 'Badge'

export { badgeVariants }
