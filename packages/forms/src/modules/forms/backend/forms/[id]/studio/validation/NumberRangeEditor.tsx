'use client'

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type NumberRangeEditorProps = {
  min: number | undefined
  max: number | undefined
  onChange: (next: { min?: number | null; max?: number | null }) => void
}

function parseNumberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

export function NumberRangeEditor({ min, max, onChange }: NumberRangeEditorProps) {
  const t = useT()
  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground">
        {t('forms.studio.validation.range.heading')}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">
            {t('forms.studio.validation.range.min')}
          </label>
          <Input
            type="number"
            inputMode="decimal"
            value={typeof min === 'number' ? String(min) : ''}
            onChange={(event) => {
              const parsed = parseNumberOrNull(event.target.value)
              onChange({ min: parsed })
            }}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">
            {t('forms.studio.validation.range.max')}
          </label>
          <Input
            type="number"
            inputMode="decimal"
            value={typeof max === 'number' ? String(max) : ''}
            onChange={(event) => {
              const parsed = parseNumberOrNull(event.target.value)
              onChange({ max: parsed })
            }}
          />
        </div>
      </div>
    </div>
  )
}
