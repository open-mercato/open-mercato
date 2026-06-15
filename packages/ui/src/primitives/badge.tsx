"use client"

import * as React from 'react'
import { X } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Status / category pill primitive. Phase B.8 rewrite per Figma
 * `Badge` page (`119:2863`) — `Badge [1.1]` (`118:2324`, color + size
 * matrix) and `Status Badge [1.1]` (`171:5100`, semantic-colored
 * status pills).
 *
 * Backward compatibility (83 import sites — biggest cascade in v5):
 * - The complete `variant` union (`default | secondary | destructive
 *   | outline | muted | success | warning | info | neutral | error`)
 *   stays callable verbatim.
 * - Every existing import-site renders identically — no padding
 *   bump, no font-weight delta, no color change.
 * - `className` passthrough works for every variant.
 *
 * New (additive):
 * - `size: 'sm' | 'default' | 'lg'` — text-xs / text-xs / text-sm
 *   typography ladder with matching px/py padding.
 * - `dot: boolean` — leading 6px dot in the variant's accent color
 *   (status-style "● Active" pattern per Figma).
 * - `removable: boolean` + `onRemove` — trailing X icon-button for
 *   tag-style dismissible badges.
 * - `brand` variant — brand-violet/10 tint per `Tag` brand variant
 *   (kept distinct from generic info / neutral — used for renewal
 *   tags, custom views).
 */

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        // Kept verbatim from the base contract — BC guarantee in spec
        // 2026-05-13-ds-foundation-v5.md mandates existing variants must
        // render byte-identically. For the soft error-toned look, use
        // the new `error` variant below.
        destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
        outline: 'text-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        success: 'border-status-success-border bg-status-success-bg text-status-success-text',
        warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
        info: 'border-status-info-border bg-status-info-bg text-status-info-text',
        neutral: 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-text',
        error: 'border-status-error-border bg-status-error-bg text-status-error-text',
        // Phase B.8 addition — brand-violet tinted pill for custom
        // views / renewal tags. Mirrors `Tag` brand variant.
        brand: 'border-brand-violet/30 bg-brand-violet/10 text-brand-violet',
      },
      size: {
        sm: 'px-2 py-0.5 text-[10px]',
        default: 'px-2.5 py-0.5 text-xs',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

// Leading-dot tone per variant. Uses the icon-color end of the status
// token palette so the dot reads against the soft tinted background.
const BADGE_DOT_TONE: Record<NonNullable<VariantProps<typeof badgeVariants>['variant']>, string> = {
  default: 'bg-primary-foreground',
  secondary: 'bg-secondary-foreground',
  destructive: 'bg-status-error-icon',
  outline: 'bg-foreground',
  muted: 'bg-muted-foreground',
  success: 'bg-status-success-icon',
  warning: 'bg-status-warning-icon',
  info: 'bg-status-info-icon',
  neutral: 'bg-muted-foreground',
  error: 'bg-status-error-icon',
  brand: 'bg-brand-violet',
}

// Leading-dot size per badge size.
const BADGE_DOT_SIZE: Record<NonNullable<VariantProps<typeof badgeVariants>['size']>, string> = {
  sm: 'size-1.5',
  default: 'size-1.5',
  lg: 'size-2',
}

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>
export type BadgeSize = NonNullable<VariantProps<typeof badgeVariants>['size']>

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants> & {
    /** Leading status dot in the variant's accent tone. */
    dot?: boolean
    /** Trailing X icon-button for tag-style dismissible badges.
     * Renders only when `removable` is true. */
    removable?: boolean
    /** Click handler for the remove button. Required when `removable`
     * is true. */
    onRemove?: (event: React.MouseEvent<HTMLButtonElement>) => void
    /** Accessible label for the remove button. Default `'Remove'`. */
    removeAriaLabel?: string
  }

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  (
    {
      className,
      variant,
      size,
      dot = false,
      removable = false,
      onRemove,
      removeAriaLabel = 'Remove',
      children,
      ...props
    },
    ref,
  ) => {
    const resolvedVariant = (variant ?? 'default') as BadgeVariant
    const resolvedSize = (size ?? 'default') as BadgeSize
    return (
      <div
        ref={ref}
        data-slot="badge"
        data-variant={resolvedVariant}
        data-size={resolvedSize}
        className={cn(badgeVariants({ variant, size }), className)}
        {...props}
      >
        {dot ? (
          <span
            data-slot="badge-dot"
            aria-hidden="true"
            className={cn(
              'inline-block shrink-0 rounded-full',
              BADGE_DOT_SIZE[resolvedSize],
              BADGE_DOT_TONE[resolvedVariant],
            )}
          />
        ) : null}
        {children}
        {removable ? (
          <button
            type="button"
            data-slot="badge-remove"
            aria-label={removeAriaLabel}
            onClick={onRemove}
            className={cn(
              '-mr-0.5 ml-0.5 inline-flex shrink-0 items-center justify-center rounded-full outline-none transition-opacity',
              'opacity-70 hover:opacity-100 focus-visible:opacity-100',
              resolvedSize === 'lg' ? 'size-4' : 'size-3.5',
            )}
          >
            <X aria-hidden="true" className={resolvedSize === 'lg' ? 'size-3' : 'size-2.5'} />
          </button>
        ) : null}
      </div>
    )
  },
)

Badge.displayName = 'Badge'

export { badgeVariants }
