"use client"

import * as React from 'react'
import { X } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from './button'

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
        16: 'h-4 gap-0.5 px-2 py-0 text-overline leading-3 font-medium uppercase tracking-badge-small',
        20: 'h-5 gap-0.5 px-2 py-0 text-xs leading-4 font-medium tracking-normal',
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
  16: 'size-1',
  20: 'size-1',
}

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>
export type BadgeSize = NonNullable<VariantProps<typeof badgeVariants>['size']>

export type BadgeAppearance = 'filled' | 'light' | 'lighter' | 'stroke'
export type BadgeTone = 'neutral' | 'info' | 'warning' | 'error' | 'success' | 'pink' | 'yellow' | 'purple' | 'sky' | 'teal'

const BADGE_APPEARANCES: Record<BadgeTone, Record<BadgeAppearance, string>> = {
  "neutral": {
    "filled": "border-transparent bg-status-neutral-solid text-status-neutral-solid-foreground",
    "light": "border-transparent bg-status-neutral-border/80 text-status-neutral-text",
    "lighter": "border-transparent bg-status-neutral-bg text-status-neutral-text",
    "stroke": "border-status-neutral-icon bg-background text-status-neutral-text"
  },
  "info": {
    "filled": "border-transparent bg-status-info-solid text-status-info-solid-foreground",
    "light": "border-transparent bg-status-info-border/80 text-status-info-text",
    "lighter": "border-transparent bg-status-info-bg text-status-info-text",
    "stroke": "border-status-info-icon bg-background text-status-info-text"
  },
  "warning": {
    "filled": "border-transparent bg-status-warning-solid text-status-warning-solid-foreground",
    "light": "border-transparent bg-status-warning-border/80 text-status-warning-text",
    "lighter": "border-transparent bg-status-warning-bg text-status-warning-text",
    "stroke": "border-status-warning-icon bg-background text-status-warning-text"
  },
  "error": {
    "filled": "border-transparent bg-status-error-solid text-status-error-solid-foreground",
    "light": "border-transparent bg-status-error-border/80 text-status-error-text",
    "lighter": "border-transparent bg-status-error-bg text-status-error-text",
    "stroke": "border-status-error-icon bg-background text-status-error-text"
  },
  "success": {
    "filled": "border-transparent bg-status-success-solid text-status-success-solid-foreground",
    "light": "border-transparent bg-status-success-border/80 text-status-success-text",
    "lighter": "border-transparent bg-status-success-bg text-status-success-text",
    "stroke": "border-status-success-icon bg-background text-status-success-text"
  },
  "pink": {
    "filled": "border-transparent bg-status-pink-solid text-status-pink-solid-foreground",
    "light": "border-transparent bg-status-pink-border/80 text-status-pink-text",
    "lighter": "border-transparent bg-status-pink-bg text-status-pink-text",
    "stroke": "border-status-pink-icon bg-background text-status-pink-text"
  },
  yellow: {
    filled: 'border-transparent bg-badge-yellow-solid text-badge-yellow-solid-foreground',
    light: 'border-transparent bg-badge-yellow-light text-badge-yellow-text',
    lighter: 'border-transparent bg-badge-yellow-bg text-badge-yellow-text',
    stroke: 'border-badge-yellow-border bg-background text-badge-yellow-text'
  },
  purple: {
    filled: 'border-transparent bg-badge-purple-solid text-badge-purple-solid-foreground',
    light: 'border-transparent bg-badge-purple-light text-badge-purple-text',
    lighter: 'border-transparent bg-badge-purple-bg text-badge-purple-text',
    stroke: 'border-badge-purple-border bg-background text-badge-purple-text'
  },
  sky: {
    filled: 'border-transparent bg-badge-sky-solid text-badge-sky-solid-foreground',
    light: 'border-transparent bg-badge-sky-light text-badge-sky-text',
    lighter: 'border-transparent bg-badge-sky-bg text-badge-sky-text',
    stroke: 'border-badge-sky-border bg-background text-badge-sky-text'
  },
  teal: {
    filled: 'border-transparent bg-badge-teal-solid text-badge-teal-solid-foreground',
    light: 'border-transparent bg-badge-teal-light text-badge-teal-text',
    lighter: 'border-transparent bg-badge-teal-bg text-badge-teal-text',
    stroke: 'border-badge-teal-border bg-background text-badge-teal-text'
  },
}

function resolveBadgeTone(variant: BadgeVariant): BadgeTone {
  return variant === 'info' || variant === 'warning' || variant === 'error' || variant === 'success' || variant === 'neutral' ? variant : 'neutral'
}

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants> & {
    /** Leading status dot in the variant's accent tone. */
    dot?: boolean
    appearance?: BadgeAppearance
    tone?: BadgeTone
    numeric?: boolean
    leadingIcon?: React.ReactNode
    trailingIcon?: React.ReactNode
    disabled?: boolean
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
      appearance,
      tone,
      numeric = false,
      leadingIcon,
      trailingIcon,
      disabled = false,
      onClick,
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
    const resolvedAppearance = appearance ?? (tone ? 'lighter' : undefined)
    const resolvedTone = tone ?? resolveBadgeTone(resolvedVariant)
    const sourceSize = typeof resolvedSize === 'number'
    const iconClassName = cn('inline-flex shrink-0 items-center justify-center [&>svg]:size-full', resolvedSize === 'lg' || resolvedSize === 20 ? 'size-4' : 'size-3')
    const dotElement = <span
      data-slot="badge-dot"
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 rounded-full',
        BADGE_DOT_SIZE[resolvedSize],
        disabled || resolvedAppearance ? 'bg-current' : BADGE_DOT_TONE[resolvedVariant],
      )}
    />
    return (
      <div
        ref={ref}
        data-slot="badge"
        data-variant={resolvedVariant}
        data-size={resolvedSize}
        data-appearance={resolvedAppearance}
        data-tone={resolvedAppearance ? resolvedTone : undefined}
        data-disabled={disabled || undefined}
        data-numeric={numeric || undefined}
        className={cn(
          badgeVariants({ variant, size }),
          sourceSize && leadingIcon != null && 'pl-1',
          sourceSize && trailingIcon != null && 'pr-1',
          sourceSize && dot && 'gap-0',
          sourceSize && dot && (resolvedSize === 20 ? 'pl-0.5' : 'pl-0'),
          numeric && 'justify-center px-0.5 tabular-nums',
          numeric && (resolvedSize === 16 ? 'min-w-4' : resolvedSize === 20 ? 'min-w-5' : 'min-w-6'),
          resolvedAppearance && 'shadow-none',
          resolvedAppearance && BADGE_APPEARANCES[resolvedTone][resolvedAppearance],
          disabled && 'border-border-disabled bg-bg-disabled text-text-disabled shadow-none',
          className,
        )}
        {...props}
        aria-disabled={disabled || props['aria-disabled']}
        onClick={disabled ? undefined : onClick}
      >
        {dot && (sourceSize
          ? <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">{dotElement}</span>
          : dotElement)}
        {leadingIcon != null && <span data-slot="badge-leading-icon" aria-hidden="true" className={iconClassName}>{leadingIcon}</span>}
        {children}
        {trailingIcon != null && <span data-slot="badge-trailing-icon" aria-hidden="true" className={iconClassName}>{trailingIcon}</span>}
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            data-slot="badge-remove"
            aria-label={removeAriaLabel}
            onClick={onRemove}
            className={cn(
              '-mr-0.5 ml-0.5 inline-flex shrink-0 items-center justify-center rounded-full p-0 text-inherit outline-none transition-opacity hover:bg-transparent hover:text-inherit focus-visible:shadow-focus',
              'opacity-70 hover:opacity-100 focus-visible:opacity-100',
              resolvedSize === 'lg' ? 'size-4' : 'size-3.5',
            )}
          >
            <X aria-hidden="true" className={resolvedSize === 'lg' ? 'size-3' : 'size-2.5'} />
          </Button>
        ) : null}
      </div>
    )
  },
)

Badge.displayName = 'Badge'

export { badgeVariants }
