import * as React from 'react'
import { X } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from './button'

const tagVariants = cva(
  'inline-flex items-center gap-1.5 border text-xs font-medium',
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
      shape: {
        pill: 'rounded-full px-2.5 py-0.5',
        square: 'rounded-md px-2 py-1',
      },
    },
    defaultVariants: { variant: 'default', shape: 'pill' },
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

export type TagShape = 'pill' | 'square'

export type TagProps = React.HTMLAttributes<HTMLSpanElement> &
  Pick<VariantProps<typeof tagVariants>, 'shape'> & {
    variant?: TagVariant
    dot?: boolean
    appearance?: 'stroke' | 'gray'
    leading?: React.ReactNode
    sublabel?: React.ReactNode
    /**
     * Render an inline close ("×") button after the label. When provided, the button
     * fires `onRemove` on click and stops propagation so a click on the chip body is
     * not triggered. Matches Figma "Dismiss Icon=On" Tag variants.
     */
    onRemove?: () => void
    /** Accessible label for the close button. Defaults to `Remove`. */
    removeAriaLabel?: string
    /** Visually mute the chip and disable its close button. */
    disabled?: boolean
  }

export function Tag({
  className,
  variant = 'default',
  shape = 'pill',
  dot = false,
  appearance,
  leading,
  sublabel,
  onRemove,
  removeAriaLabel = 'Remove',
  disabled = false,
  children,
  ...props
}: TagProps) {
  return (
    <span
      className={cn(
        tagVariants({ variant, shape }),
        appearance === 'stroke' && 'border-border bg-background text-muted-foreground',
        appearance === 'gray' && 'border-transparent bg-muted text-muted-foreground',
        appearance && !disabled && 'transition-colors hover:border-transparent hover:bg-muted active:border-foreground active:bg-background active:text-foreground focus-within:border-foreground focus-within:text-foreground',
        disabled && (appearance ? 'border-border-disabled bg-bg-disabled text-text-disabled' : 'opacity-60'),
        className,
      )}
      aria-disabled={disabled || undefined}
      data-slot="tag"
      data-shape={shape}
      data-appearance={appearance}
      {...props}
    >
      {dot && (
        <span
          className={cn('inline-block size-1.5 rounded-full shrink-0', disabled && appearance ? 'bg-text-disabled' : dotColorMap[variant])}
          aria-hidden="true"
        />
      )}
      {leading != null && <span data-slot="tag-leading" aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center overflow-hidden [&>*]:max-h-full [&>*]:max-w-full [&>svg]:size-full">{leading}</span>}
      <span className="min-w-0">{children}</span>
      {sublabel != null && <span data-slot="tag-sublabel" className={cn('font-normal', disabled && appearance ? 'text-text-disabled' : 'text-muted-foreground')}>{sublabel}</span>}
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:bg-transparent',
            disabled && !appearance && 'disabled:opacity-60',
            shape === 'pill' ? 'size-3' : 'size-4',
          )}
          aria-label={removeAriaLabel}
          data-slot="tag-remove"
        >
          <X
            className={shape === 'pill' ? 'size-2.5' : 'size-3.5'}
            aria-hidden="true"
          />
        </Button>
      ) : null}
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
