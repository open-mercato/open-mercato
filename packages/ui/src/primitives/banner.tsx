'use client'

import * as React from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Rocket, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { alertVariants, type AlertStatus, type AlertStyle } from './alert'
import { Button } from './button'

export type BannerProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'style'> & {
  title: React.ReactNode
  description?: React.ReactNode
  status?: AlertStatus
  style?: AlertStyle
  action?: React.ReactNode
  showIcon?: boolean
  onDismiss?: () => void
  dismissAriaLabel?: string
}

const icons = { error: AlertCircle, warning: AlertTriangle, success: CheckCircle2, information: Info, feature: Rocket }
const solidClasses = {
  error: 'bg-status-error-solid text-status-error-solid-foreground',
  warning: 'bg-status-warning-solid text-status-warning-solid-foreground',
  success: 'bg-status-success-solid text-status-success-solid-foreground',
  information: 'bg-status-info-solid text-status-info-solid-foreground',
  feature: 'bg-status-neutral-solid text-status-neutral-solid-foreground',
}
const iconClasses = {
  error: 'text-status-error-icon', warning: 'text-status-warning-icon', success: 'text-status-success-icon', information: 'text-status-info-icon', feature: 'text-status-neutral-icon',
}

/**
 * Figma Banner224:2249: centered full-width message,20px icon and44px
 * minimum height. Long content wraps on narrow screens. Uses the existing
 * accessible solid status roles rather than low-contrast icon fills.
 */
export const Banner = React.forwardRef<HTMLDivElement, BannerProps>(
  ({ title, description, status = 'information', style = 'lighter', action, showIcon = true, onDismiss, dismissAriaLabel, className, ...props }, ref) => {
    const t = useT()
    const Icon = icons[status]
    return (
      <div ref={ref} role={status === 'error' ? 'alert' : 'status'} data-slot="banner" data-status={status} data-style={style}
        className={cn(alertVariants({ status, style, size: 'sm' }), 'min-h-11 items-center justify-center gap-3 rounded-none border-x-0 border-t-0 px-12 py-3 shadow-none tracking-normal', style === 'filled' && solidClasses[status], 'border-0', style === 'stroke' && 'ring-1 ring-inset ring-border', className)} {...props}>
        {showIcon ? <Icon aria-hidden="true" className={cn('size-5 shrink-0', style !== 'filled' && iconClasses[status])} /> : null}
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm leading-5">
          <span className="font-medium">{title}</span>
          {description ? <><span aria-hidden="true" className="hidden sm:inline">·</span><span>{description}</span></> : null}
          {action ? <span className="ml-1 inline-flex items-center">{action}</span> : null}
        </div>
        {onDismiss ? <Button type="button" variant="ghost" size="icon" className="absolute right-3 top-1/2 size-5 -translate-y-1/2 p-0 text-inherit hover:text-inherit" onClick={onDismiss} aria-label={dismissAriaLabel ?? t('ui.banner.dismiss', 'Dismiss banner')}><X aria-hidden="true" className="size-5" /></Button> : null}
      </div>
    )
  },
)
Banner.displayName = 'Banner'
