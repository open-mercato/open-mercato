"use client"

import * as React from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Multi-step progress indicator for wizards, onboarding flows, checkout
 * funnels.
 *
 * Anchored on Figma:
 * - `Step Indicator Horizontal [1.1]` (DS OM componentSet `3507:28`) —
 *   horizontal flow: each item followed by a chevron-right icon
 *   connector except the last item, which has no trailing connector
 * - `Step Indicator Horizontal Items [1.1]` (componentSet `3505:3498`) —
 *   horizontal item with 3 states (Default / Active / Completed)
 * - `Step Indicator Vertical [1.1]` (componentSet `3507:227`) — vertical
 *   pill list (each item is its own bg+rounded container)
 * - `Step Indicator Vertical Items [1.1]` (componentSet `3507:190`) —
 *   vertical item with 3 states
 *
 * Distinct from `Progress` (continuous %) — StepIndicator is discrete
 * (Step 2 of 5) with named labels per step.
 *
 * The four `status` values supported by this primitive are:
 *
 * - `'pending'`  — Figma "Default" (white dot, muted label)
 * - `'current'`  — Figma "Active"  (accent-indigo dot, foreground label)
 * - `'complete'` — Figma "Completed" (status-success dot with check)
 * - `'error'`    — extension beyond the Figma source. Figma does not
 *   model an error state, but real product surfaces (failed checkout
 *   step, rejected workflow step) need one. Rendered with
 *   `status-error-icon` + an X glyph, paralleling the success branch.
 *
 * ```tsx
 * const steps: StepIndicatorStep[] = [
 *   { id: 'account', label: 'Account', status: 'complete' },
 *   { id: 'profile', label: 'Profile', status: 'current' },
 *   { id: 'review',  label: 'Review',  status: 'pending'  },
 * ]
 * <StepIndicator steps={steps} />
 * <StepIndicator steps={steps} orientation="vertical" />
 *
 * // Interactive — only completed + current become clickable by default
 * <StepIndicator steps={steps} onStepClick={(id) => goToStep(id)} />
 * ```
 */

export type StepIndicatorStatus = 'pending' | 'current' | 'complete' | 'error'

export type StepIndicatorStep = {
  /** Stable id, returned by onStepClick. */
  id: string
  /** Label rendered beside the dot. */
  label: string
  /** Optional sub-text rendered below the label (vertical only). */
  description?: string
  /** Current visual state. */
  status: StepIndicatorStatus
}

const rootVariants = cva('flex', {
  variants: {
    orientation: {
      horizontal: 'flex-row items-center gap-4',
      vertical: 'flex-col items-stretch gap-2',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
})

// Horizontal item: dot + gap + label, no own bg/border (lives inline).
const horizontalItemVariants = cva('inline-flex items-center gap-2', {
  variants: {
    status: {
      pending: '',
      current: '',
      complete: '',
      error: '',
    },
  },
  defaultVariants: { status: 'pending' },
})

// Vertical item: pill container per Figma `Step Indicator Vertical Items
// [1.1]` (`cornerRadius: 10`). Active item raises with bg-background;
// pending / complete items sit on bg-muted/40 (Figma `#F7F7F7`).
const verticalItemVariants = cva(
  'inline-flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors w-full',
  {
    variants: {
      status: {
        pending: 'bg-muted/40',
        current: 'bg-background ring-1 ring-border',
        complete: 'bg-muted/40',
        error: 'bg-status-error-bg ring-1 ring-status-error-border',
      },
    },
    defaultVariants: { status: 'pending' },
  },
)

// Dot — 20×20 rounded-full per Figma. Solid bg per state, no internal
// number (Figma sample uses the Default state as an empty white circle).
const dotVariants = cva(
  'relative z-10 inline-flex shrink-0 items-center justify-center rounded-full transition-colors',
  {
    variants: {
      size: {
        sm: 'size-4',
        default: 'size-5',
      },
      status: {
        pending: 'border border-muted-foreground/30 bg-background',
        current: 'bg-accent-indigo text-accent-indigo-foreground',
        complete:
          'bg-status-success-icon text-status-success-bg',
        error: 'bg-status-error-icon text-status-error-bg',
      },
    },
    defaultVariants: { size: 'default', status: 'pending' },
  },
)

const labelVariants = cva('text-sm leading-tight', {
  variants: {
    status: {
      pending: 'text-muted-foreground',
      current: 'text-foreground font-medium',
      complete: 'text-muted-foreground',
      error: 'text-status-error-text font-medium',
    },
  },
  defaultVariants: { status: 'pending' },
})

export type StepIndicatorProps = React.HTMLAttributes<HTMLOListElement> &
  VariantProps<typeof rootVariants> & {
    steps: StepIndicatorStep[]
    size?: 'sm' | 'default'
    /** Optional callback. When provided, every step becomes a button. */
    onStepClick?: (stepId: string) => void
    /** Optional restriction on which statuses are clickable. Defaults to
     * `['complete', 'current']` — past + present only. */
    clickableStatuses?: StepIndicatorStatus[]
  }

const DEFAULT_CLICKABLE: StepIndicatorStatus[] = ['complete', 'current']

function renderDotContent(status: StepIndicatorStatus): React.ReactNode {
  if (status === 'complete') return <Check aria-hidden="true" className="size-3" />
  if (status === 'error') return <X aria-hidden="true" className="size-3" />
  return null
}

export const StepIndicator = React.forwardRef<HTMLOListElement, StepIndicatorProps>(
  (
    {
      className,
      steps,
      orientation,
      size,
      onStepClick,
      clickableStatuses = DEFAULT_CLICKABLE,
      ...props
    },
    ref,
  ) => {
    const t = useT()
    const isVertical = orientation === 'vertical'
    const interactive = typeof onStepClick === 'function'

    return (
      <ol
        ref={ref}
        data-slot="step-indicator"
        aria-orientation={isVertical ? 'vertical' : 'horizontal'}
        className={cn(rootVariants({ orientation }), className)}
        {...props}
      >
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1
          const canClick = interactive && clickableStatuses.includes(step.status)

          const dotNode = (
            <span
              data-slot="step-indicator-dot"
              data-status={step.status}
              className={cn(dotVariants({ size, status: step.status }))}
              aria-current={step.status === 'current' ? 'step' : undefined}
            >
              {renderDotContent(step.status)}
            </span>
          )

          const labelNode = (
            <div className="min-w-0">
              <span className={cn(labelVariants({ status: step.status }))}>{step.label}</span>
              {step.description && isVertical ? (
                <span className="mt-0.5 block text-xs text-muted-foreground leading-tight">
                  {step.description}
                </span>
              ) : null}
            </div>
          )

          // Vertical trailing chevron — Figma shows it only on the
          // Active item to mark "you are here" (the rest of the rail
          // is bg + rounded-lg + dot).
          const verticalTrailingChevron =
            isVertical && step.status === 'current' ? (
              <ChevronRight
                aria-hidden="true"
                className="ml-auto size-4 text-muted-foreground"
              />
            ) : null

          const itemBody = isVertical ? (
            <span
              className={cn(
                verticalItemVariants({ status: step.status }),
                canClick && 'cursor-pointer',
              )}
            >
              {dotNode}
              {labelNode}
              {verticalTrailingChevron}
            </span>
          ) : (
            <span className={cn(horizontalItemVariants({ status: step.status }))}>
              {dotNode}
              {labelNode}
            </span>
          )

          return (
            <li
              key={step.id}
              data-slot="step-indicator-item"
              data-status={step.status}
              className={cn(
                isVertical ? 'list-none' : 'flex items-center gap-4 list-none',
              )}
            >
              {canClick ? (
                <button
                  type="button"
                  onClick={() => onStepClick?.(step.id)}
                  aria-label={t('ui.stepIndicator.goToStep.ariaLabel', 'Go to step: {label}', { label: step.label })}
                  className={cn(
                    'inline-flex items-center gap-2',
                    isVertical && 'w-full',
                    'rounded-md outline-none focus-visible:shadow-focus text-left',
                  )}
                >
                  {itemBody}
                </button>
              ) : (
                itemBody
              )}
              {/* Horizontal connector — Figma uses a chevron-right
                  icon between items, NOT a line. */}
              {!isVertical && !isLast ? (
                <ChevronRight
                  aria-hidden="true"
                  data-slot="step-indicator-connector"
                  className="size-4 shrink-0 text-muted-foreground/50"
                />
              ) : null}
            </li>
          )
        })}
      </ol>
    )
  },
)
StepIndicator.displayName = 'StepIndicator'

export {
  rootVariants as stepIndicatorRootVariants,
  dotVariants as stepIndicatorDotVariants,
  horizontalItemVariants as stepIndicatorHorizontalItemVariants,
  verticalItemVariants as stepIndicatorVerticalItemVariants,
}
