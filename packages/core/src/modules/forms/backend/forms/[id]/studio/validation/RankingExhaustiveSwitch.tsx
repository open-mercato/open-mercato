'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Switch } from '@open-mercato/ui/primitives/switch'

export type RankingExhaustiveSwitchProps = {
  value: boolean
  onChange: (next: boolean) => void
}

/**
 * Phase E — ranking exhaustive toggle. When on, the validation service emits
 * a `rankingExhaustive` rule and the runner refuses submissions that don't
 * rank every option (R-5 mitigation — partial rankings are surfaced as an
 * author-visible setting).
 */
export function RankingExhaustiveSwitch({ value, onChange }: RankingExhaustiveSwitchProps) {
  const t = useT()
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="font-medium text-foreground">
        {t('forms.studio.field.ranking.exhaustive')}
      </span>
      <Switch checked={value} onCheckedChange={(next) => onChange(Boolean(next))} />
    </label>
  )
}
