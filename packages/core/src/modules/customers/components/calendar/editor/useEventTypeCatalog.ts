"use client"

import * as React from 'react'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { calendarEventTypes, type EffectiveCalendarEventType } from '../../../calendar-event-types'
import type { CalendarEventTypeCatalog, ScopedCalendarEventType } from '../../../lib/calendar/eventTypeResolver'
import { KIND_CONFIG, type EditorKindConfig, type EditorTypeOption } from '../../../lib/calendar/editorPayload'
import { createScopedEditorCache, useEditorScopeKey } from './scopedEditorCache'

// `stale` is a failed refresh of a catalog this scope already confirmed. The items stay on
// screen so an open draft survives, but selection and save must treat it like a failure.
type CatalogState = { status: 'loading' | 'error' | 'stale' | 'ready'; items: readonly ScopedCalendarEventType[] }

// Last catalog loaded per tenant and organization. A reopened editor renders straight
// from it and revalidates in the background, so the form never mounts twice (once
// without the selected type's fields, once with them) on every open. The catalog is
// scoped data, so a switch must never serve the previous organization's entry.
const cachedCatalogs = createScopedEditorCache<readonly ScopedCalendarEventType[]>()

export function clearEventTypeCatalogCache(): void {
  cachedCatalogs.clear()
}

function sameCatalog(left: readonly ScopedCalendarEventType[], right: readonly ScopedCalendarEventType[]): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

function catalogStateFromCache(scopeKey: string): CatalogState {
  const cached = cachedCatalogs.get(scopeKey)
  return cached ? { status: 'ready', items: cached } : { status: 'loading', items: [] }
}

export function useEventTypeCatalog(open: boolean) {
  const scopeKey = useEditorScopeKey()
  const [state, setState] = React.useState<CatalogState & { scopeKey: string }>(() => ({ ...catalogStateFromCache(scopeKey), scopeKey }))
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    // A closed editor warms the cache once; every open revalidates it.
    if (!open && cachedCatalogs.has(scopeKey)) return
    let active = true
    setState((previous) => {
      const cached = cachedCatalogs.get(scopeKey)
      if (previous.scopeKey === scopeKey) {
        if (previous.status === 'stale') return previous
        if (cached && previous.status === 'ready' && previous.items === cached) return previous
        if (!cached && previous.status === 'loading') return previous
      }
      return { ...catalogStateFromCache(scopeKey), scopeKey }
    })
    void readApiResultOrThrow<CalendarEventTypeCatalog>('/api/customers/activity-types')
      .then((catalog) => {
        if (!active) return
        if (!Array.isArray(catalog.items)) throw new Error('[internal] Invalid activity type catalog')
        const cached = cachedCatalogs.get(scopeKey)
        const items = cached && sameCatalog(cached, catalog.items) ? cached : catalog.items
        cachedCatalogs.set(scopeKey, items)
        setState((previous) => previous.scopeKey === scopeKey && previous.status === 'ready' && previous.items === items ? previous : { status: 'ready', items, scopeKey })
      })
      .catch((error) => {
        if (!active) return
        cachedCatalogs.delete(scopeKey)
        getTelemetryRuntime()?.reportError(error, {
          module: 'customers',
          code: 'customers.activity_type_catalog_load_failed',
        })
        setState((previous) => previous.scopeKey === scopeKey && (previous.status === 'ready' || previous.status === 'stale')
          ? { status: 'stale', items: previous.items, scopeKey }
          : { status: 'error', items: [], scopeKey })
      })
    return () => { active = false }
  }, [open, attempt, scopeKey])

  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  const current = state.scopeKey === scopeKey ? state : catalogStateFromCache(scopeKey)

  return { status: current.status, items: current.items, retry }
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
