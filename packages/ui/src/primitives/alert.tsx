"use client"

import * as React from 'react'
import { AlertCircle, CheckCircle2, Info, Rocket, X, AlertTriangle } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

export type AlertStatus = 'error' | 'warning' | 'success' | 'information' | 'feature'
export type AlertStyle = 'filled' | 'light' | 'lighter' | 'stroke'
export type AlertSize = 'xs' | 'sm' | 'default'

/**
 * Legacy `variant` values from the pre-Figma-`169:2358` API. Kept for BC —
 * mapped to `status` inside the Alert component so existing call sites do
 * not need migration. The Figma `light` look (`#fecaca` saturated tint
 * for error → `state/{x}/light` token family) is heavier than the
 * pre-Figma look; legacy call sites that want the softer pre-Figma
 * appearance should switch explicitly to `style="lighter"`.
 */
type LegacyVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info'

const legacyVariantToStatus: Record<LegacyVariant, AlertStatus> = {
  default: 'information',
  destructive: 'error',
  success: 'success',
  warning: 'warning',
  info: 'information',
}

const alertVariants = cva(
  'relative flex w-full gap-2 transition-colors',
  {
    variants: {
      status: {
        error: '',
        warning: '',
        success: '',
        information: '',
        feature: '',
      },
      style: {
        filled: '',
        light: '',
        lighter: '',
        stroke: '',
      },
      size: {
        // Figma X-Small: px-[8px] py-[6px], radius-8, Paragraph/X Small (12/16)
        xs: 'min-h-8 items-center rounded-lg px-2 py-1.5 text-xs leading-4 tracking-tight',
        // Figma Small: px-[10px] py-[8px], radius-8, Paragraph/Small (14/20)
        sm: 'min-h-9 items-center rounded-lg px-2.5 py-2 text-sm leading-5 tracking-tight',
        // Figma Large: px-[12px] py-[10px], radius-12, Paragraph/Small (14/20) multi-line
        default: 'items-start rounded-xl px-3 py-2.5 text-sm leading-5 tracking-tight',
      },
    },
    compoundVariants: [
      // === filled (Figma: bg = state/{x}/base, text = static-white) ===
      { status: 'error',       style: 'filled', className: 'border border-transparent bg-status-error-icon text-white' },
      { status: 'warning',     style: 'filled', className: 'border border-transparent bg-status-warning-icon text-white' },
      { status: 'success',     style: 'filled', className: 'border border-transparent bg-status-success-icon text-white' },
      { status: 'information', style: 'filled', className: 'border border-transparent bg-status-info-icon text-white' },
      { status: 'feature',     style: 'filled', className: 'border border-transparent bg-status-neutral-icon text-white' },
      // === light (Figma: bg = state/{x}/light, text = text/strong-950 = #171717 black) ===
      { status: 'error',       style: 'light', className: 'border border-transparent bg-status-error-border text-foreground' },
      { status: 'warning',     style: 'light', className: 'border border-transparent bg-status-warning-border text-foreground' },
      { status: 'success',     style: 'light', className: 'border border-transparent bg-status-success-border text-foreground' },
      { status: 'information', style: 'light', className: 'border border-transparent bg-status-info-border text-foreground' },
      { status: 'feature',     style: 'light', className: 'border border-transparent bg-status-neutral-border text-foreground' },
      // === lighter (Figma: bg = state/{x}/lighter, text = text/strong-950 = #171717 black) ===
      { status: 'error',       style: 'lighter', className: 'border border-transparent bg-status-error-bg text-foreground' },
      { status: 'warning',     style: 'lighter', className: 'border border-transparent bg-status-warning-bg text-foreground' },
      { status: 'success',     style: 'lighter', className: 'border border-transparent bg-status-success-bg text-foreground' },
      { status: 'information', style: 'lighter', className: 'border border-transparent bg-status-info-bg text-foreground' },
      { status: 'feature',     style: 'lighter', className: 'border border-transparent bg-status-neutral-bg text-foreground' },
      // === stroke (Figma: bg = white, border = stroke/soft-200, text = strong-950, shadow = regular-shadow/medium) ===
      { style: 'stroke', className: 'border border-border bg-background text-foreground shadow-lg' },
    ],
    defaultVariants: {
      status: 'information',
      style: 'light',
      size: 'sm',
    },
  },
)

// Dismiss button (X) color per Figma: text/strong-950 (#171717 black) at
// `opacity-40` for light/lighter/stroke — matches the Figma `close-line`
// icon which is the dark icon-strong-950 fill rendered at 40% alpha
// (visually ≈ #5c5c5c gray). White at full opacity for filled so it
// stays legible over the saturated bg.
const alertDismissVariants = cva(
  'shrink-0 rounded-md p-0.5 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
  {
    variants: {
      style: {
        filled: 'text-white opacity-90 hover:opacity-100',
        light: 'text-foreground opacity-40 hover:opacity-100',
        lighter: 'text-foreground opacity-40 hover:opacity-100',
        stroke: 'text-foreground opacity-40 hover:opacity-100',
      },
    },
    defaultVariants: { style: 'light' },
  },
)

const alertIconBadgeVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-full text-white',
  {
    variants: {
      status: {
        error: 'bg-status-error-icon',
        warning: 'bg-status-warning-icon',
        success: 'bg-status-success-icon',
        information: 'bg-status-info-icon',
        feature: 'bg-status-neutral-icon',
      },
      size: {
        xs: 'size-4 [&>svg]:size-2.5',
        sm: 'size-5 [&>svg]:size-3',
        default: 'size-6 [&>svg]:size-3.5',
      },
    },
    defaultVariants: { status: 'information', size: 'sm' },
  },
)

const defaultStatusIcons: Record<AlertStatus, React.ComponentType<{ className?: string; 'aria-hidden'?: 'true' }>> = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  information: Info,
  feature: Rocket,
}

export type AlertProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'role'> &
  Omit<VariantProps<typeof alertVariants>, 'status' | 'style' | 'size'> & {
    status?: AlertStatus
    style?: AlertStyle
    size?: AlertSize
    /** Show the leading icon. Default `true`. */
    showIcon?: boolean
    /** Override the default per-status Lucide icon. */
    icon?: React.ReactNode
    /** Render a trailing close (X) button. Pair with `onDismiss`. */
    dismissible?: boolean
    onDismiss?: () => void
    dismissAriaLabel?: string
    /** Inline action slot (link buttons) rendered to the right of the body. */
    action?: React.ReactNode
    /**
     * @deprecated Use `status` + `style` instead. Kept for BC. Maps the
     * legacy single-prop variants onto `status` and picks up the new
     * `light` + `sm` defaults.
     */
    variant?: LegacyVariant
  }

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  (
    {
      className,
      status,
      style,
      size,
      showIcon = true,
      icon,
      dismissible = false,
      onDismiss,
      dismissAriaLabel = 'Dismiss',
      action,
      variant,
      children,
      ...props
    },
    ref,
  ) => {
    const resolvedStatus: AlertStatus = status ?? (variant ? legacyVariantToStatus[variant] : 'information')
    const resolvedStyle: AlertStyle = style ?? 'light'
    const resolvedSize: AlertSize = size ?? 'sm'
    const IconComponent = defaultStatusIcons[resolvedStatus]
    const rawIcon = icon ?? <IconComponent aria-hidden="true" />

    let iconSlot: React.ReactNode = null
    if (showIcon) {
      if (resolvedStyle === 'filled') {
        // Filled: plain icon over saturated bg — no badge wrap, inherit text-white.
        iconSlot = (
          <span
            className={cn(
              'inline-flex shrink-0 items-center justify-center',
              resolvedSize === 'default' ? '[&>svg]:size-5' : '[&>svg]:size-4',
            )}
            data-slot="alert-icon"
          >
            {rawIcon}
          </span>
        )
      } else {
        // light / lighter / stroke: badge wrap with status color bg + white icon.
        iconSlot = (
          <span
            className={alertIconBadgeVariants({ status: resolvedStatus, size: resolvedSize })}
            data-slot="alert-icon-badge"
            data-status={resolvedStatus}
          >
            {rawIcon}
          </span>
        )
      }
    }

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          alertVariants({ status: resolvedStatus, style: resolvedStyle, size: resolvedSize }),
          className,
        )}
        data-slot="alert"
        data-status={resolvedStatus}
        data-style={resolvedStyle}
        {...props}
      >
        {iconSlot}
        <div className="min-w-0 flex-1">{children}</div>
        {action ? <div className="shrink-0">{action}</div> : null}
        {dismissible ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissAriaLabel}
            className={alertDismissVariants({ style: resolvedStyle })}
            data-slot="alert-dismiss"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
    )
  },
)
Alert.displayName = 'Alert'

// Figma "Label/Small": Inter Medium 14 / 20.
const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('mb-1 text-sm font-medium leading-5', className)} {...props} />
  ),
)
AlertTitle.displayName = 'AlertTitle'

// Figma "Paragraph/Small": Inter Regular 14 / 20.
const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm leading-5', className)} {...props} />
  ),
)
AlertDescription.displayName = 'AlertDescription'

export { Alert, AlertDescription, AlertTitle, alertVariants, alertIconBadgeVariants }
