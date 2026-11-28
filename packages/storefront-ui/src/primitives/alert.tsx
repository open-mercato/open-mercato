import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from '../lib/icons'

const alertVariants = cva('flex w-full items-start gap-3 rounded-sf-field px-4 py-3 text-sf-body-sm [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0', {
  variants: {
    status: {
      neutral: 'bg-muted text-foreground [&>svg]:text-muted-foreground',
      information: 'bg-status-info-bg text-status-info-text [&>svg]:text-status-info-icon',
      success: 'bg-status-success-bg text-status-success-text [&>svg]:text-status-success-icon',
      warning: 'bg-status-warning-bg text-status-warning-text [&>svg]:text-status-warning-icon',
      error: 'bg-status-error-bg text-status-error-text [&>svg]:text-status-error-icon',
    },
  },
  defaultVariants: { status: 'neutral' },
})

const statusIcon = {
  neutral: <InfoIcon />,
  information: <InfoIcon />,
  success: <CircleCheckIcon />,
  warning: <TriangleAlertIcon />,
  error: <CircleAlertIcon />,
}

export type AlertProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'title'> &
  VariantProps<typeof alertVariants> & {
    title?: React.ReactNode
    icon?: React.ReactNode | false
    /** Inline action, for example "Undo", "Reload", "Try again". */
    action?: React.ReactNode
    /** Renders a dismiss button with this accessible name. */
    dismissLabel?: string
    onDismiss?: () => void
  }

/** The only error channel in cart and checkout besides field errors. Error status announces assertively. */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { className, status, title, icon, action, dismissLabel, onDismiss, children, role, ...props },
  ref,
) {
  const resolvedStatus = status ?? 'neutral'
  return (
    <div
      ref={ref}
      data-slot="alert"
      data-status={resolvedStatus}
      role={role ?? (resolvedStatus === 'error' ? 'alert' : 'status')}
      className={cn(alertVariants({ status }), className)}
      {...props}
    >
      {icon === false ? null : icon ?? statusIcon[resolvedStatus]}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p>{title}</p> : null}
        {children ? <div className="text-sf-body-sm [&_a]:underline [&_a]:underline-offset-4">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 text-sf-body-sm [&_button]:cursor-pointer [&_button]:underline [&_button]:underline-offset-4">{action}</div> : null}
      {dismissLabel && onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="-mr-1 -mt-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sf-badge opacity-70 outline-none hover:opacity-100 focus-visible:shadow-focus [&_svg]:size-4"
        >
          <XIcon />
        </button>
      ) : null}
    </div>
  )
})

export { alertVariants }
