'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Label } from '@open-mercato/ui/primitives/label'

export type OpinionIconValue = 'star' | 'dot' | 'thumb'

export type OpinionIconSelectProps = {
  value: OpinionIconValue
  onChange: (next: OpinionIconValue) => void
}

/**
 * Phase D — opinion_scale icon selector. The three choices map directly to
 * `x-om-opinion-icon`. `'dot'` is the default, persisted as the absence of the
 * keyword (R-9 — minimal persisted bytes).
 */
export function OpinionIconSelect({ value, onChange }: OpinionIconSelectProps) {
  const t = useT()
  const selectId = React.useId()
  return (
    <div className="space-y-1">
      <Label htmlFor={selectId} className="block text-xs font-medium text-muted-foreground">
        {t('forms.studio.field.opinion.icon.label')}
      </Label>
      <Select value={value} onValueChange={(next) => onChange(next as OpinionIconValue)}>
        <SelectTrigger id={selectId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="star">{t('forms.studio.field.opinion.icon.star')}</SelectItem>
          <SelectItem value="dot">{t('forms.studio.field.opinion.icon.dot')}</SelectItem>
          <SelectItem value="thumb">{t('forms.studio.field.opinion.icon.thumb')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
