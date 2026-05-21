'use client'

import * as React from 'react'

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
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
        {steps.map((entry) => {
          const selected = value === entry
          return (
            <button
              key={entry}
              type="button"
              disabled={!interactive}
              aria-pressed={selected}
              onClick={() => onChange(entry)}
              className={
                'inline-flex h-10 min-w-10 items-center justify-center rounded-md border px-2 text-sm font-medium tabular-nums transition-colors '
                + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-indigo/50 '
                + 'disabled:cursor-not-allowed disabled:opacity-60 '
                + (selected
                  ? 'border-accent-indigo bg-accent-indigo text-accent-indigo-foreground'
                  : 'border-border bg-background text-foreground hover:border-accent-indigo hover:text-accent-indigo')
              }
            >
              {entry}
            </button>
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
      <input
        id={id}
        type="range"
        min={min}
        max={safeMax}
        step={1}
        value={sliderValue}
        disabled={!interactive}
        aria-label={ariaLabel}
        aria-valuenow={value ?? undefined}
        aria-valuemin={min}
        aria-valuemax={safeMax}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
        className="block w-full cursor-pointer accent-accent-indigo disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{min}</span>
        <span>{safeMax}</span>
      </div>
    </div>
  )
}
