"use client"

import * as React from 'react'
import { buildFormFieldsFromCustomFields, fetchCustomFieldFormStructure } from '@open-mercato/ui/backend/utils/customFieldForms'
import { filterCustomFieldDefs, type CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { validateValuesAgainstDefs } from '@open-mercato/shared/modules/entities/validation'
import { useOrganizationScopeDetail, useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { getCurrentOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/organizationEvents'

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

// Last structure loaded per tenant, organization and entity. Like the type catalog, a
// reopened editor renders from it and revalidates in the background so the custom-field
// group does not pop into the form after the first paint. Definitions are scoped data,
// so a switch must never serve the previous organization's entry.
const cachedDefinitions = new Map<string, CustomFieldDefDto[]>()

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
  const scope = useOrganizationScopeDetail()
  const scopeVersion = useOrganizationScopeVersion()
  const cacheKey = `${scope.tenantId ?? ''}:${scope.organizationId ?? ''}:${entityId}`
  const [storedState, setState] = React.useState<CustomFieldsState & { cacheKey: string }>(() => ({ ...customFieldsStateFromCache(cacheKey), cacheKey }))
  React.useEffect(() => {
    if (!open && cachedDefinitions.has(cacheKey)) return
    let active = true
    const requestScopeVersion = getCurrentOrganizationScopeVersion()
    setState((previous) => {
      const cached = cachedDefinitions.get(cacheKey)
      if (previous.cacheKey === cacheKey) {
        if (cached && previous.status === 'ready' && previous.definitions === cached) return previous
        if (!cached && previous.status === 'loading' && previous.definitions.length === 0) return previous
      }
      return { ...customFieldsStateFromCache(cacheKey), cacheKey }
    })
    void fetchCustomFieldFormStructure([entityId]).then(({ definitions }) => {
      // The answer belongs to the scope the request left under, not to the current one.
      if (requestScopeVersion !== getCurrentOrganizationScopeVersion()) return
      const cached = cachedDefinitions.get(cacheKey)
      const next = cached && sameDefinitions(cached, definitions) ? cached : definitions
      cachedDefinitions.set(cacheKey, next)
      if (!active) return
      setState((previous) => previous.cacheKey === cacheKey && previous.status === 'ready' && previous.definitions === next ? previous : { definitions: next, status: 'ready', cacheKey })
    }).catch(() => {
      if (!active) return
      setState((previous) => previous.cacheKey === cacheKey && previous.status === 'ready' ? previous : { definitions: [], status: 'error', cacheKey })
    })
    return () => { active = false }
  }, [open, entityId, cacheKey, scopeVersion])
  const state = storedState.cacheKey === cacheKey ? storedState : customFieldsStateFromCache(cacheKey)
  const definitions = React.useMemo(() => selectCalendarCustomFields(state.definitions, fieldsetIds), [state.definitions, fieldsetIds])
  const fields = React.useMemo(() => buildFormFieldsFromCustomFields(definitions), [definitions])
  return { definitions, allDefinitions: state.definitions, fields, status: state.status }
}
