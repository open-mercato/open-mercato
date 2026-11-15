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

export function useCalendarCustomFields(open: boolean, entityId: string, fieldsetIds: readonly string[]) {
  const [state, setState] = React.useState<{ definitions: CustomFieldDefDto[]; status: 'loading' | 'ready' | 'error' }>({
    definitions: [], status: 'loading',
  })
  React.useEffect(() => {
    if (!open) return
    let active = true
    setState({ definitions: [], status: 'loading' })
    void fetchCustomFieldFormStructure([entityId]).then(({ definitions }) => {
      if (active) setState({ definitions, status: 'ready' })
    }).catch(() => {
      if (active) setState({ definitions: [], status: 'error' })
    })
    return () => { active = false }
  }, [open, entityId])
  const definitions = React.useMemo(() => selectCalendarCustomFields(state.definitions, fieldsetIds), [state.definitions, fieldsetIds])
  const fields = React.useMemo(() => buildFormFieldsFromCustomFields(definitions), [definitions])
  return { definitions, allDefinitions: state.definitions, fields, status: state.status }
}
