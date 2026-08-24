"use client"

import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Segmented control per Figma `Segmented Control` (node `2604:114` in DS
 * Open Mercato): radius-10 track, radius-6 selected item — small radii,
 * not pills. Renders a single track with N items where exactly one is
 * selected at a time. Selecting a new item fires `onValueChange`.
 *
 * Use for **mutually-exclusive view state** — list page filters like
 * "All / Active / Archived", chart period selectors, layout toggles
 * (List / Grid). For *related actions* (each does something different),
 * reach for `ButtonGroup` instead.
 *
 * Built on Radix `RadioGroup` so we inherit the radio-group ARIA contract
 * (`role="radiogroup"`, `role="radio"` on items, arrow-key navigation,
 * roving tabindex) for free. No new dependency — Radix RadioGroup is
 * already installed via the `Radio` primitive.
 *
 * ```tsx
 * const [view, setView] = React.useState('all')
 * <SegmentedControl value={view} onValueChange={setView} aria-label="View filter">
 *   <SegmentedControlItem value="all">All</SegmentedControlItem>
 *   <SegmentedControlItem value="active">Active</SegmentedControlItem>
 *   <SegmentedControlItem value="archived">Archived</SegmentedControlItem>
 * </SegmentedControl>
 * ```
 *
 * Sizes:
 * - `default` (h-8 / 32px) — standard toolbar density.
 * - `sm` (h-7 / 28px) — tighter; pair with `text-xs`.
 */

type SegmentedControlContextValue = {
  size: 'sm' | 'default'
  disabled?: boolean
}

const SegmentedControlContext = React.createContext<SegmentedControlContextValue>({
  size: 'default',
  disabled: false,
})

const trackVariants = cva(
  // Figma `Segmented Control [1.1]` (2604:114): borderless radius-10 track on
  // bg/weak-50, 4px inner padding, 4px gap, radius-6 items. We use full
  // `bg-muted` (not /40) so the contrast between track and a selected
  // bg-background item stays visible in the light theme; in dark mode
  // the token already darkens further so the contrast holds.
  //
  // Height math (box-border, no border):
  //   default → track h-9 (36px) − 8px padding (p-1 ×2) = 28px → matches item h-7
  //   sm      → track h-8 (32px) − 8px padding (p-1 ×2) = 24px → matches item h-6
  'inline-flex w-fit gap-1 rounded-lg bg-muted p-1 transition-colors',
  {
    variants: {
      size: {
        sm: 'h-8',
        default: 'h-9',
      },
      disabled: {
        true: 'cursor-not-allowed opacity-60',
        false: '',
      },
    },
    defaultVariants: {
      size: 'default',
      disabled: false,
    },
  },
)

const itemVariants = cva(
  // Items are radius-6 tiles inside the track's 4px padding. Per Figma the
  // selected tile lifts via bg-background + the toggle shadow + Medium (500)
  // weight on strong text; unselected labels are Regular muted. Hover only
  // nudges color (no bg change — keeps the track flat).
  'inline-flex items-center justify-center rounded-sm font-normal ' +
    'transition-all outline-none focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    'data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:font-medium data-[state=checked]:shadow-sm ' +
    'data-[state=unchecked]:bg-transparent data-[state=unchecked]:text-muted-foreground data-[state=unchecked]:hover:text-foreground',
  {
    variants: {
      size: {
        sm: 'h-6 px-2.5 text-xs',
        default: 'h-7 px-3 text-sm',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

export type SegmentedControlProps = Omit<
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>,
  'orientation'
> &
  VariantProps<typeof trackVariants> & {
    /** Optional screen-reader label for the radio group. */
    'aria-label'?: string
  }

export const SegmentedControl = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  SegmentedControlProps
>(({ className, size, disabled, children, ...props }, ref) => {
  const ctx = React.useMemo<SegmentedControlContextValue>(
    () => ({ size: size ?? 'default', disabled: disabled ?? false }),
    [size, disabled],
  )
  return (
    <SegmentedControlContext.Provider value={ctx}>
      <RadioGroupPrimitive.Root
        ref={ref}
        orientation="horizontal"
        disabled={disabled ?? undefined}
        data-slot="segmented-control"
        className={cn(trackVariants({ size, disabled }), className)}
        {...props}
      >
        {children}
      </RadioGroupPrimitive.Root>
    </SegmentedControlContext.Provider>
  )
})
SegmentedControl.displayName = 'SegmentedControl'

export type SegmentedControlItemProps = React.ComponentPropsWithoutRef<
  typeof RadioGroupPrimitive.Item
>

export const SegmentedControlItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  SegmentedControlItemProps
>(({ className, children, ...props }, ref) => {
  const { size } = React.useContext(SegmentedControlContext)
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      data-slot="segmented-control-item"
      className={cn(itemVariants({ size }), className)}
      {...props}
    >
      {children}
    </RadioGroupPrimitive.Item>
  )
})
SegmentedControlItem.displayName = 'SegmentedControlItem'

export { trackVariants as segmentedControlTrackVariants, itemVariants as segmentedControlItemVariants }
