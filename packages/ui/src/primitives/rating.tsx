"use client"

import * as React from 'react'
import { Circle, Heart, Star, StarHalf } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * 1-to-N star / heart / dot rating per Figma `Rating & Review [1.0]`
 * (DS Open Mercato componentSet `199969:1797`). Two distinct modes:
 *
 * - **Read-only display** — no `onChange` prop. Renders `role="img"` with
 *   an `aria-label` like "4.5 out of 5 stars". Used in product reviews,
 *   feedback summaries.
 * - **Interactive input** — `onChange` provided. Renders as a row of
 *   focusable buttons; arrow keys / number keys navigate, click /
 *   Enter / Space commits. Used in submission forms.
 *
 * ```tsx
 * // Read-only
 * <Rating value={4.5} max={5} />
 *
 * // Interactive
 * const [v, setV] = React.useState(0)
 * <Rating value={v} onChange={setV} aria-label="Your rating" />
 *
 * // Half precision (stars only — Lucide ships StarHalf but not HeartHalf)
 * <Rating value={3.5} max={5} allowHalf />
 *
 * // Heart variant
 * <Rating value={3} max={5} icon="heart" />
 * ```
 */

const ratingRootVariants = cva('inline-flex items-center gap-0.5', {
  variants: {
    size: {
      sm: '[&>*]:size-4',
      default: '[&>*]:size-5',
      lg: '[&>*]:size-6',
    },
    disabled: {
      true: 'cursor-not-allowed opacity-60',
      false: '',
    },
  },
  defaultVariants: { size: 'default', disabled: false },
})

const ratingItemColorVariants = cva('transition-colors', {
  variants: {
    fill: {
      full: 'fill-status-warning-icon text-status-warning-icon',
      half: 'fill-status-warning-icon text-status-warning-icon',
      empty: 'fill-transparent text-muted-foreground/30',
    },
  },
  defaultVariants: { fill: 'empty' },
})

type FillState = 'full' | 'half' | 'empty'

function resolveFillState(index: number, value: number, allowHalf: boolean): FillState {
  if (value >= index + 1) return 'full'
  if (allowHalf && value >= index + 0.5) return 'half'
  return 'empty'
}

function StarFull(props: React.ComponentProps<typeof Star>) {
  return <Star aria-hidden="true" {...props} />
}

function StarHalfIcon(props: React.ComponentProps<typeof StarHalf>) {
  return <StarHalf aria-hidden="true" {...props} />
}

function HeartIcon(props: React.ComponentProps<typeof Heart>) {
  return <Heart aria-hidden="true" {...props} />
}

function CircleIcon(props: React.ComponentProps<typeof Circle>) {
  return <Circle aria-hidden="true" {...props} />
}

function renderIcon(
  iconType: 'star' | 'heart' | 'circle',
  fill: FillState,
  className: string,
): React.ReactElement {
  if (iconType === 'heart') {
    // Lucide does not ship HeartHalf — half precision is treated as full
    // for hearts (consumer should set allowHalf=false when icon="heart").
    return <HeartIcon className={className} />
  }
  if (iconType === 'circle') {
    return <CircleIcon className={className} />
  }
  // star
  if (fill === 'half') return <StarHalfIcon className={className} />
  return <StarFull className={className} />
}

export type RatingProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'onChange'> &
  VariantProps<typeof ratingRootVariants> & {
    /** Current rating value (0..max). Floats allowed when `allowHalf` is `true`. */
    value: number
    /** Total number of items. Defaults to 5. */
    max?: number
    /** Optional change handler. Presence flips the primitive into interactive mode. */
    onChange?: (next: number) => void
    /** Which icon glyph to render. Defaults to `'star'`. */
    icon?: 'star' | 'heart' | 'circle'
    /** Enable half-step precision (stars only — Lucide has no HeartHalf). */
    allowHalf?: boolean
    /** When true, dim the control and block clicks. Inherited via `disabled` prop on the root. */
    disabled?: boolean
    /** Required when interactive — screen-readers announce this as the group label. */
    'aria-label'?: string
  }

export const Rating = React.forwardRef<HTMLSpanElement, RatingProps>(
  (
    {
      className,
      value,
      max = 5,
      onChange,
      icon = 'star',
      allowHalf = false,
      size,
      disabled,
      ...rest
    },
    ref,
  ) => {
    const t = useT()
    const interactive = typeof onChange === 'function'
    const handleSelect = React.useCallback(
      (next: number) => {
        if (disabled) return
        onChange?.(next)
      },
      [disabled, onChange],
    )

    // Read-only display path — plain span container with aria-label.
    if (!interactive) {
      return (
        <span
          ref={ref}
          role="img"
          aria-label={rest['aria-label'] ?? t('ui.rating.summary.ariaLabel', '{value} out of {max}', { value, max })}
          data-slot="rating"
          className={cn(ratingRootVariants({ size, disabled }), className)}
          {...rest}
        >
          {Array.from({ length: max }).map((_, index) => {
            const fill = resolveFillState(index, value, allowHalf)
            return (
              <span
                key={index}
                data-slot="rating-item"
                data-fill={fill}
                className="inline-flex items-center justify-center"
              >
                {renderIcon(icon, fill, ratingItemColorVariants({ fill }))}
              </span>
            )
          })}
        </span>
      )
    }

    // Interactive path — N buttons. Arrow keys move focus between items;
    // Home / End jump to first / last. Click / Enter / Space commits the
    // value (index + 1 for full clicks; index + 0.5 if allowHalf && the
    // click landed on the left half of the icon).
    return (
      <span
        ref={ref}
        role="radiogroup"
        aria-label={rest['aria-label']}
        data-slot="rating"
        className={cn(ratingRootVariants({ size, disabled }), className)}
        {...rest}
      >
        {Array.from({ length: max }).map((_, index) => {
          const fill = resolveFillState(index, value, allowHalf)
          // Empty rating (value === 0) falls back to the first item so it stays Tab-reachable.
          const isCurrent = value === 0 ? index === 0 : Math.ceil(value) - 1 === index
          return (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={fill !== 'empty'}
              aria-label={t('ui.rating.item.ariaLabel', '{position} of {max}', { position: index + 1, max })}
              tabIndex={isCurrent ? 0 : -1}
              data-slot="rating-item"
              data-fill={fill}
              disabled={disabled}
              onClick={(event) => {
                if (!allowHalf) {
                  handleSelect(index + 1)
                  return
                }
                const rect = event.currentTarget.getBoundingClientRect()
                const isLeftHalf = event.clientX - rect.left < rect.width / 2
                handleSelect(isLeftHalf ? index + 0.5 : index + 1)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  handleSelect(Math.min(max, value + (allowHalf ? 0.5 : 1)))
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  handleSelect(Math.max(0, value - (allowHalf ? 0.5 : 1)))
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  handleSelect(allowHalf ? 0.5 : 1)
                } else if (event.key === 'End') {
                  event.preventDefault()
                  handleSelect(max)
                }
              }}
              className={cn(
                'inline-flex items-center justify-center rounded-sm outline-none',
                'focus-visible:shadow-focus',
                'enabled:hover:scale-110 enabled:hover:transition-transform',
                'disabled:cursor-not-allowed',
              )}
            >
              {renderIcon(icon, fill, ratingItemColorVariants({ fill }))}
            </button>
          )
        })}
      </span>
    )
  },
)
Rating.displayName = 'Rating'

export { ratingRootVariants, ratingItemColorVariants }
