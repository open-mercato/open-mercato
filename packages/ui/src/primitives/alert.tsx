import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-8 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: 'border-border bg-background text-foreground',
        destructive:
          'border-destructive/60 bg-destructive/10 text-destructive dark:border-destructive/40 dark:bg-destructive/20 dark:text-destructive-foreground',
        success:
          'border-emerald-600/30 bg-emerald-500/10 text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-500/15 dark:text-emerald-50',
        warning:
          'border-amber-500/30 bg-amber-400/10 text-amber-950 dark:border-amber-400/40 dark:bg-amber-400/20 dark:text-amber-50',
        info:
          'border-sky-600/30 bg-sky-500/10 text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/20 dark:text-sky-50',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

type AlertProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
))

Alert.displayName = 'Alert'

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('mb-1 text-sm font-semibold leading-tight', className)} {...props} />
  )
)

AlertTitle.displayName = 'AlertTitle'

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm leading-relaxed', className)} {...props} />
  )
)

AlertDescription.displayName = 'AlertDescription'

export { Alert, AlertDescription, AlertTitle, alertVariants }
