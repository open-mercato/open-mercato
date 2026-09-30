'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'

export type NpsAnchorsEditorProps = {
  locale: string
  low: string
  high: string
  onChange: (next: { anchor: 'low' | 'high'; label: string | null }) => void
}

/**
 * Phase D — `x-om-nps-anchors[locale]` editor. Two text inputs side by side
 * for the Low / High caption strings. Empty string clears the locale entry so
 * a verbatim round-trip preserves the schema hash (R-9 — minimal persisted
 * bytes).
 */
export function NpsAnchorsEditor({ low, high, onChange }: NpsAnchorsEditorProps) {
  const t = useT()
  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground">
        {t('forms.studio.field.nps.anchors.low')} / {t('forms.studio.field.nps.anchors.high')}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">
            {t('forms.studio.field.nps.anchors.low')}
          </label>
          <Input
            value={low}
            onChange={(event) => {
              const next = event.target.value
              onChange({ anchor: 'low', label: next.length === 0 ? null : next })
            }}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">
            {t('forms.studio.field.nps.anchors.high')}
          </label>
          <Input
            value={high}
            onChange={(event) => {
              const next = event.target.value
              onChange({ anchor: 'high', label: next.length === 0 ? null : next })
            }}
          />
        </div>
      </div>
    </div>
  )
}
