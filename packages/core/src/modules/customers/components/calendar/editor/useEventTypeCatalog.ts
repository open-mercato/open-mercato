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

// Last catalog the session loaded. A reopened editor renders straight from it
// and revalidates in the background, so the form never mounts twice (once
// without the selected type's fields, once with them) on every open.
let cachedCatalogItems: readonly ScopedCalendarEventType[] | null = null

export function clearEventTypeCatalogCache(): void {
  cachedCatalogItems = null
}

function sameCatalog(left: readonly ScopedCalendarEventType[], right: readonly ScopedCalendarEventType[]): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

function catalogStateFromCache(): CatalogState {
  return cachedCatalogItems ? { status: 'ready', items: cachedCatalogItems } : { status: 'loading', items: [] }
}

export function useEventTypeCatalog(open: boolean) {
  const [state, setState] = React.useState<CatalogState>(catalogStateFromCache)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    // A closed editor warms the cache once; every open revalidates it.
    if (!open && cachedCatalogItems) return
    let active = true
    setState((previous) => {
      if (cachedCatalogItems) {
        return previous.status === 'ready' && previous.items === cachedCatalogItems ? previous : { status: 'ready', items: cachedCatalogItems }
      }
      return previous.status === 'loading' ? previous : { status: 'loading', items: [] }
    })
    void readApiResultOrThrow<CalendarEventTypeCatalog>('/api/customers/activity-types')
      .then((catalog) => {
        if (!Array.isArray(catalog.items)) throw new Error('[internal] Invalid activity type catalog')
        const items = cachedCatalogItems && sameCatalog(cachedCatalogItems, catalog.items) ? cachedCatalogItems : catalog.items
        cachedCatalogItems = items
        if (!active) return
        setState((previous) => previous.status === 'ready' && previous.items === items ? previous : { status: 'ready', items })
      })
      .catch((error) => {
        if (!active) return
        getTelemetryRuntime()?.reportError(error, {
          module: 'customers',
          code: 'customers.activity_type_catalog_load_failed',
        })
        setState((previous) => previous.status === 'ready' ? previous : { status: 'error', items: [] })
      })
    return () => { active = false }
  }, [open, attempt])

  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])

  return { ...state, retry }
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
