"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import type { DateGranularity } from '@open-mercato/shared/modules/analytics'

export type InlineGranularitySelectProps = {
  value: DateGranularity
  onChange: (value: DateGranularity) => void
  className?: string
}

type GranularityOption = {
  value: DateGranularity
  shortLabelKey: string
  shortFallback: string
  titleKey: string
  titleFallback: string
}

const GRANULARITY_OPTIONS: GranularityOption[] = [
  { value: 'day', shortLabelKey: 'dashboards.analytics.granularity.short.day', shortFallback: 'D', titleKey: 'dashboards.analytics.granularity.day', titleFallback: 'Day' },
  { value: 'week', shortLabelKey: 'dashboards.analytics.granularity.short.week', shortFallback: 'W', titleKey: 'dashboards.analytics.granularity.week', titleFallback: 'Week' },
  { value: 'month', shortLabelKey: 'dashboards.analytics.granularity.short.month', shortFallback: 'M', titleKey: 'dashboards.analytics.granularity.month', titleFallback: 'Month' },
  { value: 'quarter', shortLabelKey: 'dashboards.analytics.granularity.short.quarter', shortFallback: 'Q', titleKey: 'dashboards.analytics.granularity.quarter', titleFallback: 'Quarter' },
  { value: 'year', shortLabelKey: 'dashboards.analytics.granularity.short.year', shortFallback: 'Y', titleKey: 'dashboards.analytics.granularity.year', titleFallback: 'Year' },
]

export function InlineGranularitySelect({
  value,
  onChange,
  className = '',
}: InlineGranularitySelectProps) {
  const t = useT()

  return (
    <div className={`inline-flex rounded-md border border-border bg-background ${className}`} role="group">
      {GRANULARITY_OPTIONS.map((option) => {
        const isActive = option.value === value
        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            size="sm"
            title={t(option.titleKey, option.titleFallback)}
            onClick={() => onChange(option.value)}
            className={`h-auto px-2 py-0.5 text-xs font-medium transition-colors first:rounded-l-[calc(var(--radius)-2px)] last:rounded-r-[calc(var(--radius)-2px)] ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {t(option.shortLabelKey, option.shortFallback)}
          </Button>
        )
      })}
    </div>
  )
}

export default InlineGranularitySelect
