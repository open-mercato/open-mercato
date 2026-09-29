"use client"

import * as React from 'react'
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
      .catch(() => {
        if (active) setState({ status: 'error', items: [] })
      })
    return () => { active = false }
  }, [open, attempt])

  return { ...state, retry: () => setAttempt((value) => value + 1) }
}

export function selectedEventType(
  items: readonly ScopedCalendarEventType[],
  key: string,
): EffectiveCalendarEventType {
  const selected = items.find((item) => item.key === key)
  if (selected) return selected
  const baseline = calendarEventTypes.find((item) => item.key === key) ?? calendarEventTypes[0]!
  return {
    ...baseline,
    key,
    label: key,
    provenance: {},
    historical: true,
    fallbackReason: 'unknown',
  }
}

export function eventTypeOptions(
  items: readonly ScopedCalendarEventType[],
  selectedKey: string,
): EditorTypeOption[] {
  const options = items
    .filter((item) => item.selectable && !item.historical)
    .sort((left, right) => left.behavior.order - right.behavior.order)
    .map((item) => ({ value: item.key, label: item.label, icon: item.icon ?? null }))
  if (!options.some((option) => option.value === selectedKey)) {
    const current = items.find((item) => item.key === selectedKey)
    options.unshift({ value: selectedKey, label: current?.label ?? selectedKey, icon: current?.icon ?? null })
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
