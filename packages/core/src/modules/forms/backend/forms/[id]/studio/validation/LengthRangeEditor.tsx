'use client'

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type LengthRangeEditorProps = {
  min: number | undefined
  max: number | undefined
  onChange: (next: { min?: number | null; max?: number | null }) => void
}

function parseIntOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isInteger(parsed) || parsed < 0) return null
  return parsed
}

export function LengthRangeEditor({ min, max, onChange }: LengthRangeEditorProps) {
  const t = useT()
  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground">
        {t('forms.studio.validation.length.heading')}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">
            {t('forms.studio.validation.length.min')}
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={typeof min === 'number' ? String(min) : ''}
            onChange={(event) => {
              const parsed = parseIntOrNull(event.target.value)
              onChange({ min: parsed })
            }}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">
            {t('forms.studio.validation.length.max')}
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={typeof max === 'number' ? String(max) : ''}
            onChange={(event) => {
              const parsed = parseIntOrNull(event.target.value)
              onChange({ max: parsed })
            }}
          />
        </div>
      </div>
    </div>
  )
}
