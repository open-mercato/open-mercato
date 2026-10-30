"use client"

import * as React from 'react'
import { Circle, Heart, Star, StarHalf } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from './button'

/**
 * 1-to-N star / heart / dot rating per Figma `Rating & Review [1.0]`
 * (DS Open Mercato componentSet `532:4340`). Two distinct modes:
 *
 * - **Read-only display** — no `onChange` prop. Renders `role="img"` with
 *   an `aria-label` like "4.5 out of 5 stars". Used in product reviews,
 *   feedback summaries.
 * - **Interactive input** — `onChange` provided. Renders as a row of
 *   focusable buttons; arrow keys navigate, click /
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
 * // Half precision for stars and hearts
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
    const heartClassName = cn(className, fill !== 'empty' && 'fill-status-error-icon text-status-error-icon')
    if (fill === 'half') {
      return (
        <span aria-hidden="true" className={cn('relative inline-flex size-full', className)}>
          <HeartIcon className="absolute inset-0 size-full fill-transparent text-status-error-icon" />
          <HeartIcon className={cn('absolute inset-0 size-full', heartClassName)} style={{ clipPath: 'inset(0 50% 0 0)' }} />
        </span>
      )
    }
    return <HeartIcon className={heartClassName} />
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
    /** Enable half-step precision. Stars and hearts support a half-filled glyph. */
    allowHalf?: boolean
    /** When true, dim the control and block clicks. Inherited via `disabled` prop on the root. */
    disabled?: boolean
    appearance?: 'inline' | 'cell'
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
      appearance = 'inline',
      ...rest
    },
    ref,
  ) => {
    const t = useT()
    const cell = appearance === 'cell'
    const rootClassName = cn(ratingRootVariants({ size, disabled }), cell && 'gap-2 [&>*]:size-14', className)
    const iconClassName = (fill: FillState) => cn(
      cell ? 'size-8' : 'size-full',
      ratingItemColorVariants({ fill }),
      cell && fill === 'empty' && 'fill-border text-border',
      cell && fill === 'empty' && !disabled && (icon === 'heart' ? 'group-hover:fill-status-error-icon group-hover:text-status-error-icon' : 'group-hover:fill-status-warning-icon group-hover:text-status-warning-icon'),
    )
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
          data-appearance={appearance}
          className={rootClassName}
          {...rest}
        >
          {Array.from({ length: max }).map((_, index) => {
            const fill = resolveFillState(index, value, allowHalf)
            return (
              <span
                key={index}
                data-slot="rating-item"
                data-fill={fill}
                className={cn('inline-flex items-center justify-center', cell && 'rounded-lg bg-background ring-1 ring-inset ring-border shadow-xs')}
              >
                {renderIcon(icon, fill, cell ? iconClassName(fill) : ratingItemColorVariants({ fill }))}
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
        data-appearance={appearance}
        className={rootClassName}
        {...rest}
      >
        {Array.from({ length: max }).map((_, index) => {
          const fill = resolveFillState(index, value, allowHalf)
          // Empty rating (value === 0) falls back to the first item so it stays Tab-reachable.
          const isCurrent = value === 0 ? index === 0 : Math.ceil(value) - 1 === index
          return (
            <Button
              key={index}
              type="button"
              variant="ghost"
              role="radio"
              aria-checked={value > 0 && isCurrent}
              aria-label={t('ui.rating.item.ariaLabel', '{position} of {max}', { position: allowHalf && value > 0 && isCurrent ? value : index + 1, max })}
              tabIndex={isCurrent ? 0 : -1}
              data-slot="rating-item"
              data-fill={fill}
              disabled={disabled}
              onClick={(event) => {
                if (!allowHalf || event.detail === 0) {
                  handleSelect(index + 1)
                  return
                }
                const rect = event.currentTarget.getBoundingClientRect()
                const isLeftHalf = event.clientX - rect.left < rect.width / 2
                handleSelect(isLeftHalf ? index + 0.5 : index + 1)
              }}
              onKeyDown={(event) => {
                const selectAndFocus = (next: number) => {
                  if (disabled) return
                  handleSelect(next)
                  const choices = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                  choices?.[Math.max(0, Math.ceil(next) - 1)]?.focus()
                }
                if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  selectAndFocus(Math.min(max, value + (allowHalf ? 0.5 : 1)))
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  selectAndFocus(Math.max(0, value - (allowHalf ? 0.5 : 1)))
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  selectAndFocus(allowHalf ? 0.5 : 1)
                } else if (event.key === 'End') {
                  event.preventDefault()
                  selectAndFocus(max)
                }
              }}
              className={cn(
                'inline-flex items-center justify-center p-0 outline-none has-[>svg]:p-0',
                cell ? 'group rounded-lg bg-background ring-1 ring-inset ring-border shadow-xs hover:bg-muted hover:ring-transparent hover:shadow-none' : 'rounded-sm hover:bg-transparent disabled:bg-transparent dark:hover:bg-transparent',
                'focus-visible:shadow-focus',
                !cell && 'enabled:hover:scale-110 enabled:hover:transition-transform',
                'disabled:cursor-not-allowed',
              )}
            >
              {renderIcon(icon, fill, iconClassName(fill))}
            </Button>
          )
        })}
      </span>
    )
  },
)
Rating.displayName = 'Rating'

export { ratingRootVariants, ratingItemColorVariants }
