'use client'

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { validateValuesAgainstDefs } from '@open-mercato/shared/modules/entities/validation'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmbeddedCrudField, type CrudField } from '../CrudForm'
import type { CustomFieldDefDto } from '../utils/customFieldDefs'
import { fetchCustomFieldFormStructure } from '../utils/customFieldForms'
import { normalizeCrudServerError } from '../utils/serverErrors'
import { ErrorMessage } from './ErrorMessage'
import { LoadingMessage } from './LoadingMessage'

type AddressValues = Record<string, unknown>

type FieldLabels = {
  loading: string
  error: string
  retry: string
}

type FieldStatus = 'loading' | 'ready' | 'error'

export type AddressCustomFieldStructure = {
  entityId: string
  status: FieldStatus
  fields: CrudField[]
  definitions: CustomFieldDefDto[]
  retry: () => void
}

export type AddressTileCustomFields = {
  structure: AddressCustomFieldStructure
  labels: FieldLabels
  renderValues: (values: AddressValues) => React.ReactNode
}

const emptyFields: CrudField[] = []
const emptyDefinitions: CustomFieldDefDto[] = []
const emptyValues: AddressValues = {}

export function useAddressCustomFields(entityId: string, enabled = true): AddressCustomFieldStructure {
  const scopeVersion = useOrganizationScopeVersion()
  const [attempt, setAttempt] = React.useState(0)
  const [result, setResult] = React.useState<{
    key: string
    fields: CrudField[]
    definitions: CustomFieldDefDto[]
    status: 'ready' | 'error'
  }>()
  const key = `${entityId}:${scopeVersion}:${attempt}`

  React.useEffect(() => {
    if (!enabled) return
    let active = true
    void fetchCustomFieldFormStructure(entityId, undefined, { bareIds: true }).then(
      ({ fields, definitions }) => {
        if (!active) return
        const formKeys = new Set(fields.map((field) => field.id))
        setResult({ key, fields, definitions: definitions.filter((definition) => formKeys.has(definition.key)), status: 'ready' })
      },
      () => {
        if (active) setResult({ key, fields: emptyFields, definitions: emptyDefinitions, status: 'error' })
      },
    )
    return () => { active = false }
  }, [enabled, entityId, key])

  const retry = React.useCallback(() => setAttempt((previous) => previous + 1), [])
  const current = enabled && result?.key === key ? result : undefined
  return React.useMemo(() => ({
    entityId,
    status: current?.status ?? 'loading',
    fields: current?.fields ?? emptyFields,
    definitions: current?.definitions ?? emptyDefinitions,
    retry,
  }), [current, entityId, retry])
}

export function normalizeAddressCustomFieldValue(value: unknown): unknown {
  if (typeof value === 'string' && !value.trim()) return null
  if (Array.isArray(value)) {
    const entries = value.filter((entry) => entry !== undefined)
    return entries.length ? entries : null
  }
  return value ?? null
}

export function validateAddressCustomFields(structure: AddressCustomFieldStructure, values: AddressValues) {
  const definitions = structure.definitions.map((definition) => ({
    key: definition.key,
    kind: definition.kind,
    configJson: { validation: definition.validation },
  }))
  return validateValuesAgainstDefs(values, definitions).fieldErrors
}

export function getAddressCustomFieldErrors(
  structure: AddressCustomFieldStructure,
  error: unknown,
  prefix = 'customValues',
): Record<string, string> {
  const { fieldErrors = {} } = normalizeCrudServerError(error)
  const entries = structure.fields.flatMap((field) => {
    const message = fieldErrors[`${prefix}.${field.id}`] ?? fieldErrors[`cf_${field.id}`] ?? fieldErrors[field.id]
    return message ? [[field.id, message]] : []
  })
  return Object.fromEntries(entries)
}

export function AddressCustomFieldEditor({
  structure,
  values,
  onChange,
  errors,
  recordId,
  disabled,
  labels,
}: {
  structure: AddressCustomFieldStructure
  values: AddressValues
  onChange: (key: string, value: unknown) => void
  errors?: Record<string, string>
  recordId?: string
  disabled?: boolean
  labels: FieldLabels
}) {
  const setValue = React.useCallback(
    (key: string, value: unknown) => onChange(key, normalizeAddressCustomFieldValue(value)),
    [onChange],
  )
  if (structure.status === 'loading') return <LoadingMessage label={labels.loading} />
  if (structure.status === 'error') {
    return <ErrorMessage label={labels.error} action={
      <Button type="button" variant="outline" size="sm" onClick={structure.retry}>{labels.retry}</Button>
    } />
  }
  if (!structure.fields.length) return null
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {structure.fields.map((field) => (
        <EmbeddedCrudField
          key={field.id}
          field={field}
          values={values}
          onChange={setValue}
          error={errors?.[field.id] ?? errors?.[`cf_${field.id}`]}
          disabled={disabled}
          entityId={structure.entityId}
          recordId={recordId}
        />
      ))}
    </div>
  )
}

export function useAddressCustomValueDraft(customFields?: AddressTileCustomFields) {
  const [initialValues, setInitialValues] = React.useState<AddressValues | null>(null)
  const [patch, setPatch] = React.useState<AddressValues>(emptyValues)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const reset = React.useCallback((values: AddressValues | null = null) => {
    setInitialValues(values)
    setPatch(emptyValues)
    setErrors({})
  }, [])
  const onChange = React.useCallback((key: string, value: unknown) => {
    setPatch((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => {
      const next = { ...previous }
      delete next[key]
      delete next[`cf_${key}`]
      return next
    })
  }, [])
  const structure = customFields?.structure
  const hasChanges = Object.keys(patch).length > 0
  const blocked = structure != null && structure.status !== 'ready' && (initialValues === null || hasChanges)
  const values = React.useMemo(() => {
    const defaults = initialValues === null
      ? Object.fromEntries((structure?.fields ?? []).filter((field) => field.defaultValue !== undefined).map((field) => [field.id, field.defaultValue]))
      : initialValues
    return { ...defaults, ...patch }
  }, [initialValues, patch, structure?.fields])
  const prepare = React.useCallback((): { valid: boolean; customValues?: AddressValues } => {
    if (!structure) return { valid: true }
    if (blocked) return { valid: false }
    const customValues = initialValues === null ? values : patch
    if (initialValues !== null && !hasChanges) return { valid: true }
    const fieldErrors = validateAddressCustomFields(structure, values)
    setErrors(fieldErrors)
    return { valid: !Object.keys(fieldErrors).length, customValues }
  }, [blocked, hasChanges, initialValues, patch, structure, values])
  const showErrors = React.useCallback((error: unknown, prefix?: string) => {
    if (!structure) return false
    const fieldErrors = getAddressCustomFieldErrors(structure, error, prefix)
    if (!Object.keys(fieldErrors).length) return false
    setErrors(fieldErrors)
    return true
  }, [structure])
  return { blocked, values, errors, reset, setInitialValues, onChange, prepare, showErrors }
}
