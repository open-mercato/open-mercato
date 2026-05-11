import * as React from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

const tagVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-border bg-background text-muted-foreground',
        success: 'border-status-success-border bg-status-success-bg text-status-success-text',
        warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
        error:   'border-status-error-border bg-status-error-bg text-status-error-text',
        info:    'border-status-info-border bg-status-info-bg text-status-info-text',
        neutral: 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-text',
        brand:   'border-brand-violet/30 bg-brand-violet/10 text-brand-violet',
        pink:    'border-status-pink-border bg-status-pink-bg text-status-pink-text',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

const dotColorMap: Record<TagVariant, string> = {
  default: 'bg-muted-foreground',
  success: 'bg-status-success-icon',
  warning: 'bg-status-warning-icon',
  error:   'bg-status-error-icon',
  info:    'bg-status-info-icon',
  neutral: 'bg-status-neutral-icon',
  brand:   'bg-brand-violet',
  pink:    'bg-status-pink-icon',
}

export type TagVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'brand' | 'pink'

export type TagProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: TagVariant
  dot?: boolean
}

export function Tag({ className, variant = 'default', dot = false, children, ...props }: TagProps) {
  return (
    <span className={cn(tagVariants({ variant }), className)} {...props}>
      {dot && (
        <span
          className={cn('inline-block size-1.5 rounded-full shrink-0', dotColorMap[variant])}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  )
}

/**
 * Helper type: modules define their own tag label → variant mapping.
 *
 * @example
 * const leadTagMap: TagMap<'customer' | 'hot' | 'inactive'> = {
 *   customer: 'success',
 *   hot: 'error',
 *   inactive: 'neutral',
 * }
 *
 * <Tag variant={leadTagMap[tag.type]} dot>{tag.label}</Tag>
 */
export type TagMap<T extends string = string> = Record<T, TagVariant>
