"use client"

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Determinate progress bar — both linear and circular. Linear is the
 * default `Progress` export; circular is `CircularProgress`.
 *
 * Figma source: DS Open Mercato `Progress Bar` page (`450:17758`):
 * `Progress Bar [1.1]` (`450:17821`), `Progress Bar Label [1.1]`
 * (`515:3758`), `Progress Bar Line [1.1]` (`450:17810`, 5 tone
 * variants: muted / accent / destructive / warning / success),
 * `Circular Progress Bar [1.1]` (`466:4652`).
 *
 * Backward compatibility (Phase B rewrite): the original
 * `<Progress value={n} max={100} className="..." />` API stays
 * callable verbatim. The 3 existing call sites
 * (`packages/ui/src/backend/NextStepCallout.tsx`,
 * `packages/core/.../data_sync/.../runs/[id]/page.tsx`,
 * `packages/sync-akeneo/.../akeneo-config/widget.client.tsx`)
 * keep working without changes. New optional props (`size`, `tone`,
 * `showValue`, `label`, `description`) are additive.
 *
 * ```tsx
 * // Backward-compatible bare bar:
 * <Progress value={50} />
 *
 * // Labelled variant per `Progress Bar Label [1.1]`:
 * <Progress
 *   value={80}
 *   label="Data Storage"
 *   showValue
 *   description="Upgrade to unlock unlimited storage."
 * />
 *
 * // Tone variants per `Progress Bar Line [1.1]`:
 * <Progress value={42} tone="success" />
 * <Progress value={42} tone="warning" />
 * <Progress value={42} tone="destructive" />
 *
 * // Circular variant per `Circular Progress Bar [1.1]`:
 * <CircularProgress value={75} size="default" showValue />
 * ```
 */

export type ProgressTone =
  | 'accent'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'muted'

const PROGRESS_TONE_FILL: Record<ProgressTone, string> = {
  accent: 'bg-accent-indigo',
  success: 'bg-status-success-icon',
  warning: 'bg-status-warning-icon',
  destructive: 'bg-status-error-icon',
  muted: 'bg-muted-foreground',
}

const progressTrackVariants = cva(
  'relative w-full overflow-hidden rounded-full bg-input',
  {
    variants: {
      size: {
        sm: 'h-1',
        default: 'h-2',
        lg: 'h-3',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

const progressFillVariants = cva(
  'h-full transition-all duration-300 ease-in-out',
  {
    variants: {
      tone: {
        accent: PROGRESS_TONE_FILL.accent,
        success: PROGRESS_TONE_FILL.success,
        warning: PROGRESS_TONE_FILL.warning,
        destructive: PROGRESS_TONE_FILL.destructive,
        muted: PROGRESS_TONE_FILL.muted,
      },
    },
    defaultVariants: { tone: 'accent' },
  },
)

export interface ProgressProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof progressTrackVariants> {
  value: number
  max?: number
  /** Color of the filled portion. Default `accent` (indigo). */
  tone?: ProgressTone
  /** Show the percentage badge on the right of the label row. */
  showValue?: boolean
  /** Optional label rendered above the bar. */
  label?: React.ReactNode
  /** Optional description rendered below the bar in muted text. */
  description?: React.ReactNode
  /** Override the inner fill className (e.g. to apply a gradient). */
  fillClassName?: string
}

export function Progress({
  value,
  max = 100,
  size,
  tone,
  showValue,
  label,
  description,
  className,
  fillClassName,
  ...props
}: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, Math.round((value / max) * 100)))
  const hasLabelRow = label !== undefined || showValue === true
  const bar = (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      data-slot="progress"
      data-tone={tone ?? 'accent'}
      className={cn(progressTrackVariants({ size }), className)}
      {...props}
    >
      <div
        data-slot="progress-fill"
        className={cn(progressFillVariants({ tone }), fillClassName)}
        style={{ width: `${percentage}%` }}
      />
    </div>
  )

  if (!hasLabelRow && description === undefined) return bar

  return (
    <div data-slot="progress-wrapper" className="flex w-full flex-col gap-1.5">
      {hasLabelRow ? (
        <div className="flex items-center justify-between gap-3 text-sm font-medium text-foreground">
          <span data-slot="progress-label" className="min-w-0 truncate">
            {label}
          </span>
          {showValue ? (
            <span
              data-slot="progress-value"
              className="shrink-0 text-muted-foreground"
            >
              {percentage}%
            </span>
          ) : null}
        </div>
      ) : null}
      {bar}
      {description !== undefined ? (
        <div data-slot="progress-description" className="text-sm text-muted-foreground">
          {description}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------
// CircularProgress
// ---------------------------------------------------------------------

const CIRCULAR_SIZE_MAP = {
  xs: { box: 24, stroke: 3, textClass: 'text-[9px]' },
  sm: { box: 32, stroke: 3, textClass: 'text-[10px]' },
  default: { box: 48, stroke: 4, textClass: 'text-xs' },
  lg: { box: 64, stroke: 5, textClass: 'text-sm' },
} as const

export type CircularProgressSize = keyof typeof CIRCULAR_SIZE_MAP

const CIRCULAR_TONE_STROKE: Record<ProgressTone, string> = {
  accent: 'stroke-accent-indigo',
  success: 'stroke-status-success-icon',
  warning: 'stroke-status-warning-icon',
  destructive: 'stroke-status-error-icon',
  muted: 'stroke-muted-foreground',
}

export interface CircularProgressProps {
  value: number
  max?: number
  size?: CircularProgressSize
  tone?: ProgressTone
  /** Render the percentage in the centre of the ring. */
  showValue?: boolean
  /** Override the inner content (replaces the default percentage label
   * when `showValue` is true). Renders only when `showValue` is true. */
  children?: React.ReactNode
  /** Accessible label for the progressbar. Falls back to `${percentage}%`. */
  ariaLabel?: string
  className?: string
  /** Override the track ring className (defaults to `stroke-input`). */
  trackClassName?: string
  /** Override the fill ring className (defaults per `tone`). */
  fillClassName?: string
}

export function CircularProgress({
  value,
  max = 100,
  size = 'default',
  tone = 'accent',
  showValue,
  children,
  ariaLabel,
  className,
  trackClassName,
  fillClassName,
}: CircularProgressProps) {
  const percentage = Math.min(100, Math.max(0, Math.round((value / max) * 100)))
  const { box, stroke, textClass } = CIRCULAR_SIZE_MAP[size]
  const radius = (box - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - percentage / 100)
  const half = box / 2
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={ariaLabel ?? `${percentage}%`}
      data-slot="circular-progress"
      data-tone={tone}
      data-size={size}
      className={cn('relative inline-flex items-center justify-center', className)}
    >
      <svg
        width={box}
        height={box}
        viewBox={`0 0 ${box} ${box}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          data-slot="circular-progress-track"
          cx={half}
          cy={half}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className={cn('stroke-input', trackClassName)}
        />
        <circle
          data-slot="circular-progress-fill"
          cx={half}
          cy={half}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={cn(
            CIRCULAR_TONE_STROKE[tone],
            'transition-all duration-300 ease-in-out',
            fillClassName,
          )}
        />
      </svg>
      {showValue ? (
        <span
          data-slot="circular-progress-value"
          className={cn(
            'absolute inset-0 inline-flex items-center justify-center font-medium text-foreground',
            textClass,
          )}
        >
          {children ?? `${percentage}%`}
        </span>
      ) : null}
    </div>
  )
}
