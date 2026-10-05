'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Slider } from '@open-mercato/ui/primitives/slider'

export type ScaleFieldProps = {
  min: number
  max: number
  value: number | null
  onChange: (value: number) => void
  disabled?: boolean
  readOnly?: boolean
  ariaLabel?: string
  id?: string
}

// Above this many discrete steps a button row stops being practical, so we
// fall back to a slider with a value bubble that tracks the thumb.
const BUTTON_THRESHOLD = 11

export function ScaleField({
  min,
  max,
  value,
  onChange,
  disabled = false,
  readOnly = false,
  ariaLabel,
  id,
}: ScaleFieldProps) {
  const safeMax = max < min ? min : max
  const interactive = !disabled && !readOnly

  const steps = React.useMemo(() => {
    const result: number[] = []
    for (let entry = min; entry <= safeMax; entry += 1) result.push(entry)
    return result
  }, [min, safeMax])

  if (steps.length <= BUTTON_THRESHOLD) {
    return (
      <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel}>
        {steps.map((entry) => {
          const selected = value === entry
          return (
            <Button
              key={entry}
              type="button"
              variant="outline"
              disabled={!interactive}
              aria-pressed={selected}
              onClick={() => onChange(entry)}
              className={
                'h-10 min-w-10 px-2 text-sm font-medium tabular-nums '
                + (selected
                  ? 'border-accent-indigo bg-accent-indigo text-accent-indigo-foreground'
                  : 'border-border bg-background text-foreground hover:border-accent-indigo hover:text-accent-indigo')
              }
            >
              {entry}
            </Button>
          )
        })}
      </div>
    )
  }

  const sliderValue = value ?? min
  const pct = safeMax > min ? ((sliderValue - min) / (safeMax - min)) * 100 : 0
  return (
    <div className="space-y-2">
      <div className="relative h-7">
        <div
          className="pointer-events-none absolute top-0"
          style={{ left: `${pct}%`, transform: `translateX(-${pct}%)` }}
        >
          <span className="inline-flex min-w-7 justify-center rounded-md bg-foreground px-1.5 py-0.5 text-xs font-medium tabular-nums text-background">
            {value ?? '–'}
          </span>
        </div>
      </div>
      <Slider
        id={id}
        min={min}
        max={safeMax}
        step={1}
        value={[sliderValue]}
        disabled={!interactive}
        aria-label={ariaLabel}
        onValueChange={(next) => {
          const nextValue = next[0]
          if (typeof nextValue === 'number') onChange(nextValue)
        }}
      />
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{min}</span>
        <span>{safeMax}</span>
      </div>
    </div>
  )
}
