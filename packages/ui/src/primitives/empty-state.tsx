"use client"

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Plus } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from './button'

const emptyStateVariants = cva(
  'flex flex-col items-center justify-center text-center',
  {
    variants: {
      size: {
        sm: 'gap-2 px-4 py-6',
        default: 'gap-3 px-6 py-10',
        lg: 'gap-4 px-8 py-16',
      },
      variant: {
        default: 'rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30',
        subtle: 'rounded-lg',
      },
    },
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
  },
)

const titleVariants = cva('font-medium text-foreground', {
  variants: {
    size: {
      sm: 'text-sm',
      default: 'text-sm',
      lg: 'text-base',
    },
  },
  defaultVariants: { size: 'default' },
})

type LegacyAction = {
  label: string
  onClick?: () => void
  icon?: React.ReactNode
  disabled?: boolean
}

export type EmptyStateProps = VariantProps<typeof emptyStateVariants> & {
  title: string
  description?: string
  /** Custom action node — preferred for new code (e.g. `<Button>` or button group). */
  actions?: React.ReactNode
  /**
   * Optional Figma-style illustration (preferred for new code) — typically a
   * scaled SVG sourced from the DS Open Mercato illustrations library. When
   * provided, takes precedence over `icon`. Rendered without any icon-box
   * wrapping so the illustration's own circular background shows through.
   */
  illustration?: React.ReactNode
  /** Optional leading icon. With `variant="subtle"` it is wrapped in a round muted box; with default variant it sits inline tinted as muted-foreground. Ignored when `illustration` is provided. */
  icon?: React.ReactNode
  className?: string
  children?: React.ReactNode
  /** @deprecated Use `actions` with a `<Button>` instead. Legacy object kept for backwards compat with the old backend EmptyState. */
  action?: LegacyAction
  /** @deprecated Use `actions` with a `<Button>`. */
  actionLabel?: string
  /** @deprecated Use `actions` with a `<Button>`. */
  onAction?: () => void
  /** @deprecated Kept for legacy backend EmptyState consumers. Forwarded to the auto-generated action button. */
  actionLabelClassName?: string
}

export function EmptyState({
  size = 'default',
  variant = 'default',
  title,
  description,
  actions,
  illustration,
  icon,
  className,
  children,
  action,
  actionLabel,
  onAction,
  actionLabelClassName,
}: EmptyStateProps) {
  const legacyAction = action ?? (actionLabel ? { label: actionLabel, onClick: onAction } : undefined)
  const renderLegacyButton = !actions && legacyAction
  const iconBoxSize = size === 'sm' ? 'size-10' : size === 'lg' ? 'size-16' : 'size-12'

  return (
    <div className={cn(emptyStateVariants({ size, variant }), className)} data-slot="empty-state">
      {illustration ? (
        <div className="flex items-center justify-center" aria-hidden="true">
          {illustration}
        </div>
      ) : icon ? (
        variant === 'subtle' ? (
          <div
            className={cn(
              'flex items-center justify-center rounded-full bg-muted text-muted-foreground',
              iconBoxSize,
            )}
            aria-hidden="true"
          >
            {icon}
          </div>
        ) : (
          <div className="text-muted-foreground" aria-hidden="true">
            {icon}
          </div>
        )
      ) : null}
      <div className="space-y-1">
        <p className={cn(titleVariants({ size }))}>{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
      {actions ?? (renderLegacyButton ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={legacyAction!.onClick}
          className={cn('inline-flex items-center gap-2 text-foreground', actionLabelClassName)}
          disabled={legacyAction!.disabled}
        >
          {legacyAction!.icon ?? <Plus className="h-4 w-4" aria-hidden="true" />}
          <span>{legacyAction!.label}</span>
        </Button>
      ) : null)}
    </div>
  )
}

export { emptyStateVariants }
