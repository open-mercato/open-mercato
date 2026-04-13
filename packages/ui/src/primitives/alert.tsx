import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-8",
  {
    variants: {
      variant: {
        default: 'border-border bg-background text-foreground [&>svg]:text-foreground',
        destructive:
          'border-status-error-border bg-status-error-bg text-status-error-text [&>svg]:text-status-error-icon',
        success:
          'border-status-success-border bg-status-success-bg text-status-success-text [&>svg]:text-status-success-icon',
        warning:
          'border-status-warning-border bg-status-warning-bg text-status-warning-text [&>svg]:text-status-warning-icon',
        info:
          'border-status-info-border bg-status-info-bg text-status-info-text [&>svg]:text-status-info-icon',
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
