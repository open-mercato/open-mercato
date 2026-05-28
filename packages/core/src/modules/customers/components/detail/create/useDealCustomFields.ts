"use client"

import * as React from 'react'
import {
  validateValuesAgainstDefs,
  type CustomFieldDefLike,
} from '@open-mercato/shared/modules/entities/validation'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { normalizeCustomFieldSubmitValue } from '../customFieldUtils'
import type { DealCustomAttributesLoadState } from './DealCustomAttributes'
import type { Translate } from './dealFormTypes'

function isEmptyCustomFieldValue(field: CrudField, value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return field.type === 'checkbox' && value !== true
}

function mapCustomDefinitionsForValidation(definitions: CustomFieldDefDto[]): CustomFieldDefLike[] {
  return definitions.map((definition) => ({
    key: definition.key,
    kind: definition.kind,
    configJson: {
      validation: Array.isArray(definition.validation) ? definition.validation : [],
    },
  }))
}

export type UseDealCustomFieldsResult = {
  customValues: Record<string, unknown>
  customFieldsLoaded: boolean
  customCount: number
  handleCustomChange: (key: string, value: unknown) => void
  handleCustomAttributesLoaded: (state: DealCustomAttributesLoadState) => void
  validateCustomFields: (source: Record<string, unknown>) => Record<string, string>
  collectNormalizedCustomValues: (source: Record<string, unknown>) => Record<string, unknown>
}

export function useDealCustomFields(tr: Translate): UseDealCustomFieldsResult {
  const [customValues, setCustomValues] = React.useState<Record<string, unknown>>({})
  const [customFields, setCustomFields] = React.useState<CrudField[]>([])
  const [customDefinitions, setCustomDefinitions] = React.useState<CustomFieldDefDto[]>([])
  const [customFieldsLoaded, setCustomFieldsLoaded] = React.useState(false)
  const [customCount, setCustomCount] = React.useState(0)
  const customDefaultsAppliedRef = React.useRef(false)

  const handleCustomChange = React.useCallback((key: string, value: unknown) => {
    setCustomValues((current) => ({ ...current, [key]: value }))
  }, [])

  const handleCustomAttributesLoaded = React.useCallback((state: DealCustomAttributesLoadState) => {
    setCustomFields(state.fields)
    setCustomDefinitions(state.definitions)
    setCustomFieldsLoaded(true)
    setCustomCount(state.fields.length)

    if (customDefaultsAppliedRef.current || state.definitions.length === 0) return
    customDefaultsAppliedRef.current = true
    setCustomValues((current) => {
      let changed = false
      const next = { ...current }
      for (const definition of state.definitions) {
        if (definition.defaultValue === undefined || definition.defaultValue === null) continue
        const fieldId = `cf_${definition.key}`
        if (next[fieldId] !== undefined) continue
        next[fieldId] = definition.defaultValue
        changed = true
      }
      return changed ? next : current
    })
  }, [])

  const collectNormalizedCustomValues = React.useCallback((source: Record<string, unknown>) =>
    collectCustomFieldValues(source, {
      transform: (value) => normalizeCustomFieldSubmitValue(value),
    }), [])

  const validateCustomFields = React.useCallback((source: Record<string, unknown>) => {
    const fieldErrors: Record<string, string> = {}
    const requiredMessage = tr('ui.forms.errors.required', 'Required')

    for (const field of customFields) {
      if (!field.required) continue
      if (isEmptyCustomFieldValue(field, source[field.id])) {
        fieldErrors[field.id] = requiredMessage
      }
    }

    if (customDefinitions.length > 0) {
      const result = validateValuesAgainstDefs(
        collectNormalizedCustomValues(source),
        mapCustomDefinitionsForValidation(customDefinitions),
      )
      if (!result.ok) {
        for (const [fieldId, message] of Object.entries(result.fieldErrors)) {
          if (!fieldErrors[fieldId]) fieldErrors[fieldId] = tr(message, message)
        }
      }
    }

    return fieldErrors
  }, [collectNormalizedCustomValues, customDefinitions, customFields, tr])

  return {
    customValues,
    customFieldsLoaded,
    customCount,
    handleCustomChange,
    handleCustomAttributesLoaded,
    validateCustomFields,
    collectNormalizedCustomValues,
  }
}

export default useDealCustomFields
