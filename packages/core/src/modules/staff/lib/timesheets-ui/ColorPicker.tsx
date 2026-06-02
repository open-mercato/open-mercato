"use client"

import * as React from 'react'
import { Check } from 'lucide-react'
import { PROJECT_COLORS } from './colors'

export type ColorPickerProps = {
  value: string | null | undefined
  onChange: (value: string | null) => void
  allowReset?: boolean
  resetLabel?: string
  id?: string
  disabled?: boolean
}

export function ColorPicker({
  value,
  onChange,
  allowReset = true,
  resetLabel = 'Auto',
  id,
  disabled = false,
}: ColorPickerProps) {
  return (
    <div id={id} className="flex flex-wrap items-center gap-2" role="radiogroup">
      {PROJECT_COLORS.map((color) => {
        const selected = value === color.key
        return (
          <button
            key={color.key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color.key}
            title={color.key}
            disabled={disabled}
            onClick={() => onChange(color.key)}
            className={`inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
              selected ? 'ring-2 ring-offset-1 ring-ring' : ''
            }`}
            style={{ backgroundColor: color.hex }}
          >
            {selected ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
          </button>
        )
      })}
      {allowReset ? (
        <button
          type="button"
          role="radio"
          aria-checked={value == null}
          aria-label={resetLabel}
          title={resetLabel}
          disabled={disabled}
          onClick={() => onChange(null)}
          className={`inline-flex h-6 items-center cursor-pointer rounded-full border border-dashed border-muted-foreground/50 bg-transparent px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
            value == null ? 'ring-2 ring-offset-1 ring-ring' : ''
          }`}
        >
          {resetLabel}
        </button>
      ) : null}
    </div>
  )
}
