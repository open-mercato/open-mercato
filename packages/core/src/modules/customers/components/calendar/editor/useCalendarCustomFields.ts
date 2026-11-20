"use client"

import * as React from 'react'
import { buildFormFieldsFromCustomFields, fetchCustomFieldFormStructure } from '@open-mercato/ui/backend/utils/customFieldForms'
import { filterCustomFieldDefs, type CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { validateValuesAgainstDefs } from '@open-mercato/shared/modules/entities/validation'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createScopedEditorCache, useEditorScopeKey } from './scopedEditorCache'

export function selectCalendarCustomFields(definitions: CustomFieldDefDto[], fieldsetIds: readonly string[]) {
  if (!fieldsetIds.length) return filterCustomFieldDefs(definitions, 'form')
  const allowed = new Set(fieldsetIds)
  return filterCustomFieldDefs(definitions, 'form').filter((definition) => {
    const fieldsets = definition.fieldsets?.length ? definition.fieldsets : definition.fieldset ? [definition.fieldset] : []
    return fieldsets.length ? fieldsets.some((fieldset) => allowed.has(fieldset)) : allowed.has('__general__')
  })
}

export function projectCalendarCustomValues(values: Record<string, unknown>, definitions: CustomFieldDefDto[]) {
  const activeIds = new Set(definitions.map((definition) => `cf_${definition.key}`))
  return Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith('cf_') || activeIds.has(key)))
}

export function validateCalendarCustomValues(values: Record<string, unknown>, definitions: CustomFieldDefDto[]) {
  const customValues = Object.fromEntries(definitions.map((definition) => [definition.key, values[`cf_${definition.key}`]]))
  return validateValuesAgainstDefs(customValues, definitions.map((definition) => ({
    key: definition.key,
    kind: definition.kind,
    configJson: { validation: definition.validation ?? [] },
  })))
}

// `stale` is a failed refresh of definitions this scope already confirmed. They stay on screen
// so an open draft survives, but save must treat it like a failure.
type CustomFieldsState = { definitions: CustomFieldDefDto[]; status: 'loading' | 'ready' | 'stale' | 'error' }

// Last structure loaded per tenant, organization and entity. Like the type catalog, a
// reopened editor renders from it and revalidates in the background so the custom-field
// group does not pop into the form after the first paint. Definitions are scoped data,
// so a switch must never serve the previous organization's entry.
const cachedDefinitions = createScopedEditorCache<CustomFieldDefDto[]>()

export function clearCalendarCustomFieldsCache(): void {
  cachedDefinitions.clear()
}

function sameDefinitions(left: CustomFieldDefDto[], right: CustomFieldDefDto[]): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

function customFieldsStateFromCache(cacheKey: string): CustomFieldsState {
  const cached = cachedDefinitions.get(cacheKey)
  return cached ? { definitions: cached, status: 'ready' } : { definitions: [], status: 'loading' }
}

export function useCalendarCustomFields(open: boolean, entityId: string, fieldsetIds: readonly string[]) {
  const cacheKey = `${useEditorScopeKey()}:${entityId}`
  const [storedState, setState] = React.useState<CustomFieldsState & { cacheKey: string }>(() => ({ ...customFieldsStateFromCache(cacheKey), cacheKey }))
  const [attempt, setAttempt] = React.useState(0)
  React.useEffect(() => {
    if (!open && cachedDefinitions.has(cacheKey)) return
    let active = true
    setState((previous) => {
      const cached = cachedDefinitions.get(cacheKey)
      if (previous.cacheKey === cacheKey) {
        // A failed read keeps its status through a retry: the form stays mounted and unsaved.
        if (previous.status === 'stale' || previous.status === 'error') return previous
        if (cached && previous.status === 'ready' && previous.definitions === cached) return previous
        if (!cached && previous.status === 'loading' && previous.definitions.length === 0) return previous
      }
      return { ...customFieldsStateFromCache(cacheKey), cacheKey }
    })
    void fetchCustomFieldFormStructure([entityId]).then(({ definitions }) => {
      if (!active) return
      const cached = cachedDefinitions.get(cacheKey)
      const next = cached && sameDefinitions(cached, definitions) ? cached : definitions
      cachedDefinitions.set(cacheKey, next)
      setState((previous) => previous.cacheKey === cacheKey && previous.status === 'ready' && previous.definitions === next ? previous : { definitions: next, status: 'ready', cacheKey })
    }).catch((error) => {
      if (!active) return
      cachedDefinitions.delete(cacheKey)
      getTelemetryRuntime()?.reportError(error, {
        module: 'customers',
        code: 'customers.calendar_custom_fields_load_failed',
      })
      setState((previous) => previous.cacheKey === cacheKey && (previous.status === 'ready' || previous.status === 'stale')
        ? { definitions: previous.definitions, status: 'stale', cacheKey }
        : { definitions: [], status: 'error', cacheKey })
    })
    return () => { active = false }
  }, [open, attempt, entityId, cacheKey])
  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  const state = storedState.cacheKey === cacheKey ? storedState : customFieldsStateFromCache(cacheKey)
  const definitions = React.useMemo(() => selectCalendarCustomFields(state.definitions, fieldsetIds), [state.definitions, fieldsetIds])
  const fields = React.useMemo(() => buildFormFieldsFromCustomFields(definitions), [definitions])
  return { definitions, allDefinitions: state.definitions, fields, status: state.status, retry }
}
