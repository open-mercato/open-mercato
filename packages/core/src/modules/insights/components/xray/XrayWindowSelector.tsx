"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DateRangePicker } from '@open-mercato/ui/primitives/date-range-picker'
import { useDateFnsLocale } from '@open-mercato/ui/primitives/date-locale'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import type { DateRange } from '@open-mercato/ui/backend/date-range'
import {
  XRAY_CUSTOM_WINDOW_MAX_DAYS,
  XRAY_PRESET_WINDOWS,
  formatLocalDay,
  isPresetWindow,
  parseLocalDay,
  resolveCustomWindow,
  type XrayCustomWindowIssue,
  type XrayWindowState,
} from '../../lib/client/xray/window'

const CUSTOM_VALUE = 'custom'
const DEFAULT_CUSTOM_DAYS = 30

function defaultCustomRange(): DateRange {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (DEFAULT_CUSTOM_DAYS - 1))
  return { start, end: new Date(end.getFullYear(), end.getMonth(), end.getDate()) }
}

function rangeOfWindow(window: XrayWindowState): DateRange | null {
  if (window.kind !== 'custom') return null
  const start = parseLocalDay(window.start)
  const end = parseLocalDay(window.end)
  return start && end ? { start, end } : null
}

export type XrayWindowSelectorProps = {
  value: XrayWindowState
  onChange: (next: XrayWindowState) => void
  disabled?: boolean
}

/**
 * The analysis window: 7 / 30 / 90 days (calendar days in the organization's X-Ray time zone,
 * served from precomputed rollups) or a custom range of at most 180 days. An invalid custom
 * range is explained inline and never applied, so no request is made with it.
 */
export function XrayWindowSelector({ value, onChange, disabled }: XrayWindowSelectorProps) {
  const t = useT()
  const dateLocale = useDateFnsLocale()
  const [customMode, setCustomMode] = React.useState(value.kind === 'custom')
  const [draft, setDraft] = React.useState<DateRange | null>(() => rangeOfWindow(value))
  const [issue, setIssue] = React.useState<XrayCustomWindowIssue | null>(null)
  const errorId = React.useId()

  React.useEffect(() => {
    if (value.kind === 'custom') {
      setCustomMode(true)
      setDraft(rangeOfWindow(value))
      setIssue(null)
    }
  }, [value])

  const applyRange = React.useCallback((range: DateRange | null) => {
    setDraft(range)
    if (!range) return
    const start = formatLocalDay(range.start)
    const end = formatLocalDay(range.end)
    const resolved = resolveCustomWindow(start, end)
    if ('issue' in resolved) {
      setIssue(resolved.issue)
      return
    }
    setIssue(null)
    onChange({ kind: 'custom', start, end })
  }, [onChange])

  const handleSegment = React.useCallback((next: string) => {
    if (isPresetWindow(next)) {
      setCustomMode(false)
      setIssue(null)
      onChange({ kind: 'preset', key: next })
      return
    }
    if (next === CUSTOM_VALUE) {
      setCustomMode(true)
      applyRange(draft ?? defaultCustomRange())
    }
  }, [applyRange, draft, onChange])

  const selected = customMode ? CUSTOM_VALUE : value.kind === 'preset' ? value.key : CUSTOM_VALUE
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="xray-window-selector">
      <SegmentedControl
        value={selected}
        onValueChange={handleSegment}
        disabled={disabled}
        aria-label={t('insights.xray.ui.window.label')}
      >
        {XRAY_PRESET_WINDOWS.map((key) => (
          <SegmentedControlItem key={key} value={key}>
            {t(`insights.xray.ui.window.${key}`)}
          </SegmentedControlItem>
        ))}
        <SegmentedControlItem value={CUSTOM_VALUE}>{t('insights.xray.ui.window.custom')}</SegmentedControlItem>
      </SegmentedControl>
      {customMode ? (
        <DateRangePicker
          value={draft}
          onChange={applyRange}
          showPresets={false}
          maxDate={new Date()}
          locale={dateLocale}
          disabled={disabled}
          aria-label={t('insights.xray.ui.window.customRange')}
          aria-describedby={issue ? errorId : undefined}
        />
      ) : null}
      {issue ? (
        <p id={errorId} role="alert" className="text-xs text-status-error-text" data-testid="xray-window-error">
          {issue === 'too_long'
            ? t('insights.xray.ui.window.tooLong', { days: XRAY_CUSTOM_WINDOW_MAX_DAYS })
            : t('insights.xray.ui.window.invalid')}
        </p>
      ) : null}
    </div>
  )
}
