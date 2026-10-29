"use client"

import * as React from 'react'
import { buildFormFieldsFromCustomFields, fetchCustomFieldFormStructure } from '@open-mercato/ui/backend/utils/customFieldForms'
import { filterCustomFieldDefs, type CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { validateValuesAgainstDefs } from '@open-mercato/shared/modules/entities/validation'

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

type CustomFieldsState = { definitions: CustomFieldDefDto[]; status: 'loading' | 'ready' | 'error' }

// Last structure loaded per entity. Like the type catalog, a reopened editor
// renders from it and revalidates in the background so the custom-field group
// does not pop into the form after the first paint.
const cachedDefinitions = new Map<string, CustomFieldDefDto[]>()

export function clearCalendarCustomFieldsCache(): void {
  cachedDefinitions.clear()
}

function sameDefinitions(left: CustomFieldDefDto[], right: CustomFieldDefDto[]): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

function customFieldsStateFromCache(entityId: string): CustomFieldsState {
  const cached = cachedDefinitions.get(entityId)
  return cached ? { definitions: cached, status: 'ready' } : { definitions: [], status: 'loading' }
}

export function useCalendarCustomFields(open: boolean, entityId: string, fieldsetIds: readonly string[]) {
  const [state, setState] = React.useState<CustomFieldsState>(() => customFieldsStateFromCache(entityId))
  React.useEffect(() => {
    if (!open && cachedDefinitions.has(entityId)) return
    let active = true
    setState((previous) => {
      const cached = cachedDefinitions.get(entityId)
      if (cached) return previous.status === 'ready' && previous.definitions === cached ? previous : { definitions: cached, status: 'ready' }
      return previous.status === 'loading' && previous.definitions.length === 0 ? previous : { definitions: [], status: 'loading' }
    })
    void fetchCustomFieldFormStructure([entityId]).then(({ definitions }) => {
      const cached = cachedDefinitions.get(entityId)
      const next = cached && sameDefinitions(cached, definitions) ? cached : definitions
      cachedDefinitions.set(entityId, next)
      if (!active) return
      setState((previous) => previous.status === 'ready' && previous.definitions === next ? previous : { definitions: next, status: 'ready' })
    }).catch(() => {
      if (!active) return
      setState((previous) => previous.status === 'ready' ? previous : { definitions: [], status: 'error' })
    })
    return () => { active = false }
  }, [open, entityId])
  const definitions = React.useMemo(() => selectCalendarCustomFields(state.definitions, fieldsetIds), [state.definitions, fieldsetIds])
  const fields = React.useMemo(() => buildFormFieldsFromCustomFields(definitions), [definitions])
  return { definitions, allDefinitions: state.definitions, fields, status: state.status }
}
