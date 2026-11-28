import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sf-badge sf-label-case',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        neutral: 'bg-status-neutral-bg text-status-neutral-text',
        outline: 'border border-border bg-background text-foreground',
        promo: 'bg-sf-sale text-sf-sale-foreground',
        new: 'bg-status-info-bg text-status-info-text',
        'low-stock': 'bg-status-warning-bg text-status-warning-text',
        'sold-out': 'bg-status-neutral-bg text-status-neutral-text',
        info: 'bg-status-info-bg text-status-info-text',
        success: 'bg-status-success-bg text-status-success-text',
        warning: 'bg-status-warning-bg text-status-warning-text',
        error: 'bg-status-error-bg text-status-error-text',
      },
      size: {
        sm: 'h-4.5 px-2 text-sf-badge',
        default: 'h-5.5 px-2.5 text-sf-body-xs',
        lg: 'h-7 px-3 text-sf-body-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>

export type BadgeProps = React.ComponentPropsWithoutRef<'span'> &
  VariantProps<typeof badgeVariants> & {
    /** Leading status dot in the variant's text colour; pairs colour with shape. */
    dot?: boolean
  }

const BadgeBase = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, size, dot = false, children, ...props },
  ref,
) {
  return (
    <span ref={ref} data-slot="badge" className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
})

/** Order, payment and quote lifecycle statuses mapped to variants. Labels come from the app's locale files. */
export type BadgeStatus =
  | 'placed' | 'processing' | 'pending' | 'draft' | 'returned' | 'refunded'
  | 'shipped' | 'out_for_delivery' | 'sent' | 'scheduled'
  | 'delivered' | 'paid' | 'accepted' | 'approved' | 'completed' | 'active'
  | 'on_hold' | 'awaiting_approval' | 'unpaid' | 'expired' | 'invited'
  | 'cancelled' | 'overdue' | 'failed' | 'declined' | 'rejected' | 'action_required'

const statusVariant: Record<BadgeStatus, BadgeVariant> = {
  placed: 'neutral', processing: 'neutral', pending: 'neutral', draft: 'neutral', returned: 'neutral', refunded: 'neutral',
  shipped: 'info', out_for_delivery: 'info', sent: 'info', scheduled: 'info',
  delivered: 'success', paid: 'success', accepted: 'success', approved: 'success', completed: 'success', active: 'success',
  on_hold: 'warning', awaiting_approval: 'warning', unpaid: 'warning', expired: 'warning', invited: 'warning',
  cancelled: 'error', overdue: 'error', failed: 'error', declined: 'error', rejected: 'error', action_required: 'error',
}

export type BadgeStatusProps = Omit<BadgeProps, 'variant' | 'dot'> & { status: BadgeStatus }

const BadgeStatusComponent = React.forwardRef<HTMLSpanElement, BadgeStatusProps>(function BadgeStatus(
  { status, ...props },
  ref,
) {
  return <BadgeBase ref={ref} data-status={status} variant={statusVariant[status]} dot {...props} />
})

export const Badge = Object.assign(BadgeBase, { Status: BadgeStatusComponent, statusVariant })
export { badgeVariants }
