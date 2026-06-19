"use client"

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Numeric value selector — single value or two-thumb range. Used for price
 * ranges, quantity selectors, opacity / brightness controls, threshold
 * configuration. Built on Radix `@radix-ui/react-slider` so we inherit
 * the slider ARIA contract (`role="slider"`, `aria-valuemin/max/now`,
 * keyboard arrow / home / end navigation, RTL flip).
 *
 * No dedicated Figma node in the DS Open Mercato library at the time
 * this primitive was authored — `Level Slider` in the file is an emoji
 * icon, not a track-thumb component. Styling inferred from DS tokens
 * (primary brand on the selected portion, muted track, contrasting
 * thumb with focus ring) — see R4 in the v5 spec for the
 * inferred-design protocol.
 *
 * Single thumb:
 *
 * ```tsx
 * const [v, setV] = React.useState([20])
 * <Slider value={v} onValueChange={setV} min={0} max={100} step={5} />
 * ```
 *
 * Range (two thumbs):
 *
 * ```tsx
 * const [range, setRange] = React.useState([10, 60])
 * <Slider value={range} onValueChange={setRange} aria-label="Price range" />
 * ```
 *
 * Optional `aria-label` should be provided when the slider's purpose
 * is not obvious from surrounding context.
 */

const sliderRootVariants = cva(
  // Disabled cursor + greyed body via explicit disabled colors on the
  // range and thumb (NOT a blanket opacity — opacity over indigo would
  // bleed a faded indigo through the thumb, which the Figma disabled
  // state explicitly avoids).
  'relative flex w-full touch-none select-none items-center data-[disabled]:cursor-not-allowed',
  {
    variants: {
      orientation: {
        horizontal: 'h-5',
        vertical: 'h-full w-5 flex-col',
      },
    },
    defaultVariants: { orientation: 'horizontal' },
  },
)

const sliderTrackVariants = cva(
  'relative grow overflow-hidden rounded-full bg-muted',
  {
    variants: {
      orientation: {
        horizontal: 'h-1.5 w-full',
        vertical: 'w-1.5 h-full',
      },
    },
    defaultVariants: { orientation: 'horizontal' },
  },
)

const sliderRangeVariants = cva(
  // Enabled: indigo brand color (Figma `#6366F1`). Disabled: collapse to
  // a neutral mid-grey so the range visually merges with the track (the
  // Figma disabled state shows no indigo bleed at all).
  'absolute rounded-full bg-accent-indigo data-[disabled]:bg-muted-foreground/25',
  {
    variants: {
      orientation: {
        horizontal: 'h-full',
        vertical: 'w-full',
      },
    },
    defaultVariants: { orientation: 'horizontal' },
  },
)

const sliderThumbVariants = cva(
  // Figma `Slider [1.1]` (componentSet 2617:1169):
  //
  //   Enabled state — 16×16 white circle with NO outer stroke and a
  //     centered 6×6 indigo dot. Separation from the track comes from a
  //     drop shadow, not a border. Outer = `bg-background` + `shadow-sm`,
  //     inner dot via `::after` so the thumb stays a single DOM node.
  //
  //   Disabled state — same 16×16 white circle but now with a thin grey
  //     ring (the shadow is dropped entirely) and a grey inner dot. The
  //     border is what makes the thumb still legible against the track
  //     when shadow + indigo are both gone.
  'relative block size-4 rounded-full bg-background shadow-sm transition-shadow ' +
    "after:content-[''] after:absolute after:left-1/2 after:top-1/2 after:size-1.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-accent-indigo " +
    'hover:shadow-md ' +
    'focus-visible:outline-none focus-visible:shadow-focus ' +
    'data-[disabled]:pointer-events-none data-[disabled]:shadow-none data-[disabled]:border data-[disabled]:border-muted-foreground/30 ' +
    'data-[disabled]:after:bg-muted-foreground/40',
)

export type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> &
  VariantProps<typeof sliderRootVariants>

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, orientation, value, defaultValue, ...props }, ref) => {
  // Derive the number of thumbs from the value/defaultValue length so we
  // render the right number of `Thumb` nodes. Radix supports both
  // single-thumb and range; the dom-level pattern is identical apart
  // from the count of thumb children.
  const thumbCount = (() => {
    const v = (value ?? defaultValue) as number[] | undefined
    if (Array.isArray(v) && v.length > 0) return v.length
    return 1
  })()

  return (
    <SliderPrimitive.Root
      ref={ref}
      orientation={orientation ?? 'horizontal'}
      value={value}
      defaultValue={defaultValue}
      data-slot="slider-root"
      className={cn(sliderRootVariants({ orientation }), className)}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(sliderTrackVariants({ orientation }))}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(sliderRangeVariants({ orientation }))}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }).map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          data-slot="slider-thumb"
          className={cn(sliderThumbVariants())}
        />
      ))}
    </SliderPrimitive.Root>
  )
})
Slider.displayName = 'Slider'

export {
  sliderRootVariants,
  sliderTrackVariants,
  sliderRangeVariants,
  sliderThumbVariants,
}
