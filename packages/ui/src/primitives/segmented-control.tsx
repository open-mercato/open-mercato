"use client"

import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * iOS-style segmented control per Figma `Switch / Chart / Cryptocurrency`
 * (component set id `199963:1442` in DS Open Mercato). Renders a single
 * track with N items where exactly one is selected at a time. Selecting
 * a new item fires `onValueChange`.
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
  // Pill-shaped track with subtle inner padding so selected items render
  // a smaller inner pill (the iOS slide-thumb effect). Track is muted —
  // selected item raises with bg-background + shadow-sm. We use full
  // `bg-muted` (not /40) so the contrast between track and a selected
  // bg-background item stays visible in the light theme; in dark mode
  // the token already darkens further so the contrast holds.
  //
  // Height math (box-border on every element):
  //   default → track h-8 (32px) − 2px border − 2px padding (p-px ×2) = 28px → matches item h-7
  //   sm      → track h-7 (28px) − 2px border − 2px padding (p-px ×2) = 24px → matches item h-6
  // Using `p-0.5` (2px each side = 4px total) instead breaks both sizes by
  // 2px so the selected pill clips top and bottom against the track border.
  'inline-flex w-fit gap-0 rounded-full border border-input bg-muted p-px transition-colors',
  {
    variants: {
      size: {
        sm: 'h-7',
        default: 'h-8',
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
  // Items are pills that fill the track minus its 2px inner padding.
  // Selected state lifts via bg-background + shadow-sm + font-semibold
  // (the font-weight bump gives a secondary visual cue beyond color +
  // shadow, important when the surrounding theme is high-key and the
  // shadow alone is hard to read). Unselected text is muted; hover
  // only nudges color (no bg change — keeps the track flat).
  'inline-flex items-center justify-center rounded-full font-medium ' +
    'transition-all outline-none focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    'data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:font-semibold data-[state=checked]:shadow-sm ' +
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
