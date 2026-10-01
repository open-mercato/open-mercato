"use client"

import * as React from 'react'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { calendarEventTypes, type EffectiveCalendarEventType } from '../../../calendar-event-types'
import type { CalendarEventTypeCatalog, ScopedCalendarEventType } from '../../../lib/calendar/eventTypeResolver'
import { KIND_CONFIG, type EditorKindConfig, type EditorTypeOption } from '../../../lib/calendar/editorPayload'

type CatalogState =
  | { status: 'loading' | 'error'; items: readonly ScopedCalendarEventType[] }
  | { status: 'ready'; items: readonly ScopedCalendarEventType[] }

export function useEventTypeCatalog(open: boolean) {
  const [state, setState] = React.useState<CatalogState>({ status: 'loading', items: [] })
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    if (!open) {
      setState({ status: 'loading', items: [] })
      return
    }
    let active = true
    setState({ status: 'loading', items: [] })
    void readApiResultOrThrow<CalendarEventTypeCatalog>('/api/customers/activity-types')
      .then((catalog) => {
        if (!Array.isArray(catalog.items)) throw new Error('[internal] Invalid activity type catalog')
        if (active) setState({ status: 'ready', items: catalog.items })
      })
      .catch((error) => {
        if (!active) return
        getTelemetryRuntime()?.reportError(error, {
          module: 'customers',
          code: 'customers.activity_type_catalog_load_failed',
        })
        setState({ status: 'error', items: [] })
      })
    return () => { active = false }
  }, [open, attempt])

  return { ...state, retry: () => setAttempt((value) => value + 1) }
}

export function selectedEventType(
  items: readonly ScopedCalendarEventType[],
  key: string,
): EffectiveCalendarEventType {
  const normalizedKey = key.trim().toLowerCase()
  const selected = items.find((item) => item.key === normalizedKey)
  if (selected) return selected
  const baseline = calendarEventTypes.find((item) => item.key === normalizedKey) ?? calendarEventTypes[0]!
  return {
    ...baseline,
    key,
    label: key,
    provenance: {},
    historical: true,
    fallbackReason: 'unknown',
  }
}

export function isSelectableEventType(items: readonly ScopedCalendarEventType[], key: string): boolean {
  const normalizedKey = key.trim().toLowerCase()
  return items.some((item) => item.key === normalizedKey && item.selectable && !item.historical)
}

export function eventTypeOptions(
  items: readonly ScopedCalendarEventType[],
  selectedKey: string,
  translate: (key: string, fallback: string) => string,
): EditorTypeOption[] {
  const displayLabel = (item: ScopedCalendarEventType) => item.labelKey
    ? translate(item.labelKey, item.label)
    : item.label
  const normalizedSelectedKey = selectedKey.trim().toLowerCase()
  const options = items
    .filter((item) => item.selectable && !item.historical)
    .sort((left, right) => left.behavior.order - right.behavior.order)
    .map((item) => ({ value: item.key === normalizedSelectedKey ? selectedKey : item.key, label: displayLabel(item), icon: item.icon ?? null }))
  if (!options.some((option) => option.value === selectedKey)) {
    const current = items.find((item) => item.key === normalizedSelectedKey)
    options.unshift({ value: selectedKey, label: current ? displayLabel(current) : selectedKey, icon: current?.icon ?? null })
  }
  return options
}

export function eventTypeConfig(definition: EffectiveCalendarEventType): EditorKindConfig {
  const { baseKind, fields } = definition.behavior
  return {
    dateLabel: KIND_CONFIG[baseKind].dateLabel,
    hasEnd: fields.endTime,
    hasAllDay: fields.allDay,
    hasRepeat: fields.recurrence,
    location: fields.location === 'none' ? null : fields.location,
    people: fields.people === 'none' ? null : fields.people === 'recipients' ? 'to' : fields.people,
    hasPriority: fields.priority,
  }
}
