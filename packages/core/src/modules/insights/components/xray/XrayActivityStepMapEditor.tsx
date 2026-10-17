"use client"

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'

export const XRAY_STEP_MAP_MAX_ROWS = 500
const KEY_MAX_LENGTH = 200

type Row = { id: number; activity: string; step: string }

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string')
}

function rowsOf(value: unknown): Row[] {
  if (!isStringRecord(value)) return []
  return Object.entries(value).map(([activity, step], index) => ({ id: index + 1, activity, step }))
}

/** The map of non-empty rows (activity key → workflow step id); `null` when empty. */
export function stepMapOfRows(rows: ReadonlyArray<Pick<Row, 'activity' | 'step'>>): Record<string, string> | null {
  const map: Record<string, string> = {}
  for (const row of rows) {
    const activity = row.activity.trim()
    const step = row.step.trim()
    if (activity && step) map[activity] = step
  }
  return Object.keys(map).length > 0 ? map : null
}

export type XrayActivityStepMapEditorProps = {
  value: unknown
  onChange: (next: Record<string, string> | null) => void
  disabled?: boolean
  error?: string
}

/**
 * Edits the conformance mapping from observed activity keys (e.g. `status:won`) to the step
 * ids of the configured workflow. Rows with an empty side are ignored; a repeated activity
 * keeps its last step.
 */
export function XrayActivityStepMapEditor({ value, onChange, disabled, error }: XrayActivityStepMapEditorProps) {
  const t = useT()
  const [rows, setRows] = React.useState<Row[]>(() => rowsOf(value))
  const nextIdRef = React.useRef(rows.length + 1)

  const commit = React.useCallback((next: Row[]) => {
    setRows(next)
    onChange(stepMapOfRows(next))
  }, [onChange])

  const duplicates = React.useMemo(() => {
    const seen = new Set<string>()
    const repeated = new Set<string>()
    for (const row of rows) {
      const key = row.activity.trim()
      if (!key) continue
      if (seen.has(key)) repeated.add(key)
      seen.add(key)
    }
    return Array.from(repeated)
  }, [rows])

  return (
    <div className="space-y-2" data-testid="xray-step-map-editor">
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('insights.xray.ui.settings.stepMap.empty')}</p> : null}
      {rows.map((row, index) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2">
          <Input
            value={row.activity}
            maxLength={KEY_MAX_LENGTH}
            disabled={disabled}
            placeholder={t('insights.xray.ui.settings.stepMap.activityPlaceholder')}
            aria-label={t('insights.xray.ui.settings.stepMap.activity', { index: index + 1 })}
            className="min-w-0 flex-1"
            onChange={(event) => commit(rows.map((entry) => (entry.id === row.id ? { ...entry, activity: event.target.value } : entry)))}
          />
          <Input
            value={row.step}
            maxLength={KEY_MAX_LENGTH}
            disabled={disabled}
            placeholder={t('insights.xray.ui.settings.stepMap.stepPlaceholder')}
            aria-label={t('insights.xray.ui.settings.stepMap.step', { index: index + 1 })}
            className="min-w-0 flex-1"
            onChange={(event) => commit(rows.map((entry) => (entry.id === row.id ? { ...entry, step: event.target.value } : entry)))}
          />
          <IconButton
            type="button"
            variant="ghost"
            size="lg"
            disabled={disabled}
            aria-label={t('insights.xray.ui.settings.stepMap.remove', { index: index + 1 })}
            onClick={() => commit(rows.filter((entry) => entry.id !== row.id))}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || rows.length >= XRAY_STEP_MAP_MAX_ROWS}
        onClick={() => {
          const id = nextIdRef.current
          nextIdRef.current += 1
          setRows([...rows, { id, activity: '', step: '' }])
        }}
      >
        <Plus className="size-4" aria-hidden="true" />
        {t('insights.xray.ui.settings.stepMap.add')}
      </Button>
      {duplicates.length > 0 ? (
        <p className="text-xs text-status-warning-text">{t('insights.xray.ui.settings.stepMap.duplicates', { keys: duplicates.join(', ') })}</p>
      ) : null}
      {error ? <p className="text-xs text-status-error-text" role="alert">{error}</p> : null}
    </div>
  )
}
