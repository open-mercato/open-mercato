"use client"

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@/lib/i18n/context'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { DictionarySelectField } from '../formConfig'
import { createDictionarySelectLabels } from './utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useCurrencyDictionary } from './hooks/useCurrencyDictionary'
import { DictionaryEntrySelect } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { normalizeCustomFieldSubmitValue } from './customFieldUtils'

export type DealFormBaseValues = {
  title: string
  status?: string | null
  pipelineStage?: string | null
  valueAmount?: number | null
  valueCurrency?: string | null
  probability?: number | null
  expectedCloseAt?: string | null
  description?: string | null
  personIds?: string[]
  companyIds?: string[]
}

export type DealFormSubmitPayload = {
  base: DealFormBaseValues
  custom: Record<string, unknown>
}

export type DealFormProps = {
  mode: 'create' | 'edit'
  initialValues?: Partial<DealFormBaseValues & Record<string, unknown>>
  onSubmit: (payload: DealFormSubmitPayload) => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void> | void
  submitLabel?: string
  cancelLabel?: string
  isSubmitting?: boolean
}

type EntityOption = {
  id: string
  label: string
  subtitle?: string | null
}

type EntityMultiSelectProps = {
  value: string[]
  onChange: (next: string[]) => void
  placeholder: string
  emptyLabel: string
  loadingLabel: string
  noResultsLabel: string
  removeLabel: string
  errorLabel: string
  search: (query: string) => Promise<EntityOption[]>
  fetchByIds: (ids: string[]) => Promise<EntityOption[]>
  disabled?: boolean
  autoFocus?: boolean
}

const DEAL_ENTITY_IDS = [E.customers.customer_deal]
const CURRENCY_PRIORITY = ['EUR', 'USD', 'GBP', 'PLN'] as const

const schema = z.object({
  title: z
    .string({ required_error: 'customers.people.detail.deals.titleRequired' })
    .trim()
    .min(1, 'customers.people.detail.deals.titleRequired')
    .max(200, 'customers.people.detail.deals.titleTooLong'),
  status: z
    .string()
    .trim()
    .max(50, 'customers.people.detail.deals.statusTooLong')
    .optional(),
  pipelineStage: z
    .string()
    .trim()
    .max(100, 'customers.people.detail.deals.pipelineTooLong')
    .optional(),
  valueAmount: z
    .preprocess((value) => {
      if (value === '' || value === null || value === undefined) return undefined
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return undefined
        const parsed = Number(trimmed)
        if (Number.isNaN(parsed)) return value
        return parsed
      }
      return value
    }, z
      .number()
      .min(0, 'customers.people.detail.deals.valueInvalid')
      .optional())
    .optional(),
  valueCurrency: z
    .string()
    .transform((value) => value.trim().toUpperCase())
    .refine(
      (value) => !value || /^[A-Z]{3}$/.test(value),
      'customers.people.detail.deals.currencyInvalid',
    )
    .optional(),
  probability: z
    .preprocess((value) => {
      if (value === '' || value === null || value === undefined) return undefined
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return undefined
        const parsed = Number(trimmed)
        if (Number.isNaN(parsed)) return value
        return parsed
      }
      return value
    }, z
      .number()
      .min(0, 'customers.people.detail.deals.probabilityInvalid')
      .max(100, 'customers.people.detail.deals.probabilityInvalid')
      .optional())
    .optional(),
  expectedCloseAt: z
    .string()
    .transform((value) => value.trim())
    .refine(
      (value) => {
        if (!value) return true
        const parsed = new Date(value)
        return !Number.isNaN(parsed.getTime())
      },
      'customers.people.detail.deals.expectedCloseInvalid',
    )
    .optional(),
  description: z.string().max(4000, 'customers.people.detail.deals.descriptionTooLong').optional(),
  personIds: z.array(z.string().trim().min(1)).optional(),
  companyIds: z.array(z.string().trim().min(1)).optional(),
}).passthrough()

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const year = parsed.getUTCFullYear()
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0')
  const day = String(parsed.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeCurrency(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim().slice(0, 3).toUpperCase()
}

function sanitizeIdList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const set = new Set<string>()
  input.forEach((candidate) => {
    if (typeof candidate !== 'string') return
    const trimmed = candidate.trim()
    if (!trimmed.length) return
    set.add(trimmed)
  })
  return Array.from(set)
}

function extractPersonOption(record: Record<string, unknown>): EntityOption | null {
  const id = typeof record.id === 'string' ? record.id : null
  if (!id) return null
  const displayName =
    typeof record.displayName === 'string' && record.displayName.trim().length
      ? record.displayName.trim()
      : typeof record.display_name === 'string' && record.display_name.trim().length
        ? (record.display_name as string).trim()
        : null
  const email =
    typeof record.primaryEmail === 'string' && record.primaryEmail.trim().length
      ? record.primaryEmail.trim()
      : typeof record.primary_email === 'string' && record.primary_email.trim().length
        ? (record.primary_email as string).trim()
        : null
  const label = displayName ?? email ?? id
  const subtitle = email && email !== label ? email : null
  return { id, label, subtitle }
}

function extractCompanyOption(record: Record<string, unknown>): EntityOption | null {
  const id = typeof record.id === 'string' ? record.id : null
  if (!id) return null
  const displayName =
    typeof record.displayName === 'string' && record.displayName.trim().length
      ? record.displayName.trim()
      : typeof record.display_name === 'string' && record.display_name.trim().length
        ? (record.display_name as string).trim()
        : null
  const domain =
    typeof record.domain === 'string' && record.domain.trim().length
      ? record.domain.trim()
      : typeof record.websiteUrl === 'string' && record.websiteUrl.trim().length
        ? record.websiteUrl.trim()
        : typeof record.website_url === 'string' && record.website_url.trim().length
          ? (record.website_url as string).trim()
          : null
  const label = displayName ?? domain ?? id
  const subtitle = domain && domain !== label ? domain : null
  return { id, label, subtitle }
}

function EntityMultiSelect({
  value,
  onChange,
  placeholder,
  emptyLabel,
  loadingLabel,
  noResultsLabel,
  removeLabel,
  errorLabel,
  search,
  fetchByIds,
  disabled = false,
  autoFocus = false,
}: EntityMultiSelectProps) {
  const [input, setInput] = React.useState('')
  const [suggestions, setSuggestions] = React.useState<EntityOption[]>([])
  const [cache, setCache] = React.useState<Map<string, EntityOption>>(() => new Map())
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const normalizedValue = React.useMemo(() => sanitizeIdList(value), [value])

  React.useEffect(() => {
    if (!normalizedValue.length) return
    const missing = normalizedValue.filter((id) => !cache.has(id))
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      try {
        const entries = await fetchByIds(missing)
        if (cancelled) return
        setCache((prev) => {
          const next = new Map(prev)
          entries.forEach((entry) => {
            if (entry?.id) next.set(entry.id, entry)
          })
          return next
        })
      } catch {
        if (!cancelled) setError(errorLabel)
      }
    })().catch(() => {})
    return () => { cancelled = true }
  }, [cache, errorLabel, fetchByIds, normalizedValue])

  React.useEffect(() => {
    if (disabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    const handler = window.setTimeout(async () => {
      setLoading(true)
      try {
        const results = await search(input.trim())
        if (cancelled) return
        setSuggestions(results)
        setCache((prev) => {
          const next = new Map(prev)
          results.forEach((entry) => {
            if (entry?.id) next.set(entry.id, entry)
          })
          return next
        })
        setError(null)
      } catch {
        if (!cancelled) {
          setError(errorLabel)
          setSuggestions([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handler)
    }
  }, [disabled, errorLabel, input, search])

  const filteredSuggestions = React.useMemo(
    () => suggestions.filter((option) => !normalizedValue.includes(option.id)),
    [normalizedValue, suggestions],
  )

  const selectedOptions = React.useMemo(
    () => normalizedValue.map((id) => cache.get(id) ?? { id, label: id }),
    [cache, normalizedValue],
  )

  const addOption = React.useCallback(
    (option: EntityOption) => {
      if (!option?.id) return
      if (normalizedValue.includes(option.id)) return
      const next = [...normalizedValue, option.id]
      onChange(next)
      setCache((prev) => {
        const nextCache = new Map(prev)
        nextCache.set(option.id, option)
        return nextCache
      })
      setInput('')
      setSuggestions([])
    },
    [normalizedValue, onChange],
  )

  const removeOption = React.useCallback(
    (id: string) => {
      const next = normalizedValue.filter((candidate) => candidate !== id)
      onChange(next)
    },
    [normalizedValue, onChange],
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded border px-2 py-1">
        {selectedOptions.map((option) => (
          <span key={option.id} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
            {option.label}
            <button
              type="button"
              className="opacity-60 transition-opacity hover:opacity-100"
              onClick={() => removeOption(option.id)}
              aria-label={`${removeLabel} ${option.label}`}
              disabled={disabled}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="flex-1 min-w-[160px] border-0 bg-transparent py-1 text-sm outline-none"
          value={input}
          placeholder={placeholder}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const nextOption = filteredSuggestions[0]
              if (nextOption) addOption(nextOption)
            } else if (event.key === 'Backspace' && !input.length && normalizedValue.length) {
              removeOption(normalizedValue[normalizedValue.length - 1])
            }
          }}
          disabled={disabled}
          autoFocus={autoFocus}
          data-crud-focus-target=""
        />
      </div>
      {loading ? <div className="text-xs text-muted-foreground">{loadingLabel}</div> : null}
      {!loading && filteredSuggestions.length ? (
        <div className="flex flex-wrap gap-2">
          {filteredSuggestions.slice(0, 10).map((option) => (
            <button
              key={option.id}
              type="button"
              className="rounded border px-2 py-1 text-xs transition hover:bg-muted"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addOption(option)}
              disabled={disabled}
            >
              <span className="flex flex-col items-start">
                <span>{option.label}</span>
                {option.subtitle ? (
                  <span className="text-[10px] text-muted-foreground">{option.subtitle}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {!loading && !filteredSuggestions.length && input.trim().length ? (
        <div className="text-xs text-muted-foreground">{noResultsLabel}</div>
      ) : null}
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
      {!normalizedValue.length && !input.trim().length ? (
        <div className="text-xs text-muted-foreground">{emptyLabel}</div>
      ) : null}
    </div>
  )
}

export function DealForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  onDelete,
  submitLabel,
  cancelLabel,
  isSubmitting = false,
}: DealFormProps) {
  const t = useT()
  const [pending, setPending] = React.useState(false)
  const {
    data: currencyDictionaryData,
    error: currencyDictionaryErrorRaw,
    isLoading: currencyDictionaryLoading,
    refetch: refetchCurrencyDictionary,
  } = useCurrencyDictionary()
  const currencyDictionaryError = currencyDictionaryErrorRaw
    ? currencyDictionaryErrorRaw instanceof Error
      ? currencyDictionaryErrorRaw.message
      : String(currencyDictionaryErrorRaw)
    : null

  const translate = React.useCallback(
    (key: string, fallback: string) => {
      const value = t(key)
      return value === key ? fallback : value
    },
    [t],
  )

  const dictionaryLabels = React.useMemo(() => ({
    status: createDictionarySelectLabels('deal-statuses', translate),
    pipeline: createDictionarySelectLabels('pipeline-stages', translate),
  }), [translate])

  const resolvedCurrencyError = React.useMemo(() => {
    if (currencyDictionaryError) return currencyDictionaryError
    if (!currencyDictionaryLoading && !currencyDictionaryData) {
      return t('customers.deals.form.currency.missing', 'Currency dictionary is not configured yet.')
    }
    return null
  }, [currencyDictionaryData, currencyDictionaryError, currencyDictionaryLoading, t])

  const fetchCurrencyOptions = React.useCallback(async () => {
    let payload = currencyDictionaryData ?? null
    if (!payload) {
      try {
        payload = await refetchCurrencyDictionary()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err ?? '')
        throw new Error(message || t('customers.deals.form.currency.error', 'Failed to load currency dictionary.'))
      }
    }
    if (!payload) {
      throw new Error(t('customers.deals.form.currency.missing', 'Currency dictionary is not configured yet.'))
    }
    const priorityOrder = new Map<string, number>()
    CURRENCY_PRIORITY.forEach((code, index) => priorityOrder.set(code, index))
    const prioritized: { value: string; label: string; color: string | null; icon: string | null }[] = []
    const remainder: { value: string; label: string; color: string | null; icon: string | null }[] = []
    payload.entries.forEach((entry) => {
      const value = entry.value.toUpperCase()
      const label = entry.label && entry.label.length ? `${value} – ${entry.label}` : value
      const option = { value, label, color: null, icon: null }
      if (priorityOrder.has(value)) prioritized.push(option)
      else remainder.push(option)
    })
    prioritized.sort((a, b) => (priorityOrder.get(a.value)! - priorityOrder.get(b.value)!))
    remainder.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    return [...prioritized, ...remainder]
  }, [currencyDictionaryData, refetchCurrencyDictionary, t])

  const currencyDictionaryLabels = React.useMemo(() => ({
    placeholder: t('customers.deals.form.currency.placeholder', 'Select currency…'),
    addLabel: t('customers.deals.form.currency.add', 'Add currency'),
    dialogTitle: t('customers.deals.form.currency.dialogTitle', 'Add currency'),
    valueLabel: t('customers.deals.form.currency.valueLabel', 'Currency code'),
    valuePlaceholder: t('customers.deals.form.currency.valuePlaceholder', 'e.g. USD'),
    labelLabel: t('customers.deals.form.currency.labelLabel', 'Label'),
    labelPlaceholder: t('customers.deals.form.currency.labelPlaceholder', 'Display name shown in UI'),
    emptyError: t('customers.deals.form.currency.error.required', 'Currency code is required.'),
    cancelLabel: t('customers.deals.form.currency.cancel', 'Cancel'),
    saveLabel: t('customers.deals.form.currency.save', 'Save'),
    errorLoad: t('customers.deals.form.currency.error', 'Failed to load currency dictionary.'),
    errorSave: t('customers.deals.form.currency.error', 'Failed to load currency dictionary.'),
    loadingLabel: t('customers.deals.form.currency.loading', 'Loading currencies…'),
    manageTitle: t('customers.deals.form.currency.manage', 'Manage currency dictionary'),
  }), [t])

  const searchPeople = React.useCallback(async (query: string): Promise<EntityOption[]> => {
    const params = new URLSearchParams({
      pageSize: '20',
      sortField: 'name',
      sortDir: 'asc',
    })
    if (query.trim().length) params.set('search', query.trim())
    const res = await apiFetch(`/api/customers/people?${params.toString()}`)
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to search people')
    }
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => (item && typeof item === 'object' ? extractPersonOption(item as Record<string, unknown>) : null))
      .filter((entry): entry is EntityOption => !!entry)
  }, [])

  const fetchPeopleByIds = React.useCallback(async (ids: string[]): Promise<EntityOption[]> => {
    const unique = sanitizeIdList(ids)
    if (!unique.length) return []
    const results = await Promise.all(unique.map(async (id) => {
      try {
        const res = await apiFetch(`/api/customers/people?id=${encodeURIComponent(id)}&pageSize=1`)
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error()
        const items = Array.isArray(payload.items) ? payload.items : []
        const option = items
          .map((item) => (item && typeof item === 'object' ? extractPersonOption(item as Record<string, unknown>) : null))
          .find((candidate): candidate is EntityOption => !!candidate)
        return option ?? { id, label: id }
      } catch {
        return { id, label: id }
      }
    }))
    return results
  }, [])

  const searchCompanies = React.useCallback(async (query: string): Promise<EntityOption[]> => {
    const params = new URLSearchParams({
      pageSize: '20',
      sortField: 'name',
      sortDir: 'asc',
    })
    if (query.trim().length) params.set('search', query.trim())
    const res = await apiFetch(`/api/customers/companies?${params.toString()}`)
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to search companies')
    }
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => (item && typeof item === 'object' ? extractCompanyOption(item as Record<string, unknown>) : null))
      .filter((entry): entry is EntityOption => !!entry)
  }, [])

  const fetchCompaniesByIds = React.useCallback(async (ids: string[]): Promise<EntityOption[]> => {
    const unique = sanitizeIdList(ids)
    if (!unique.length) return []
    const results = await Promise.all(unique.map(async (id) => {
      try {
        const res = await apiFetch(`/api/customers/companies?id=${encodeURIComponent(id)}&pageSize=1`)
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error()
        const items = Array.isArray(payload.items) ? payload.items : []
        const option = items
          .map((item) => (item && typeof item === 'object' ? extractCompanyOption(item as Record<string, unknown>) : null))
          .find((candidate): candidate is EntityOption => !!candidate)
        return option ?? { id, label: id }
      } catch {
        return { id, label: id }
      }
    }))
    return results
  }, [])

  const disabled = pending || isSubmitting
  const canDelete = mode === 'edit' && typeof onDelete === 'function'

  const baseFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'title',
      label: t('customers.people.detail.deals.fields.title', 'Title'),
      type: 'text',
      required: true,
    },
    {
      id: 'status',
      label: t('customers.people.detail.deals.fields.status', 'Status'),
      type: 'custom',
      layout: 'half',
      component: ({ value, setValue }) => (
        <DictionarySelectField
          kind="deal-statuses"
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => setValue(next ?? '')}
          labels={dictionaryLabels.status}
          selectClassName="w-full"
        />
      ),
    } as CrudField,
    {
      id: 'pipelineStage',
      label: t('customers.people.detail.deals.fields.pipelineStage', 'Pipeline stage'),
      type: 'custom',
      layout: 'half',
      component: ({ value, setValue }) => (
        <DictionarySelectField
          kind="pipeline-stages"
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => setValue(next ?? '')}
          labels={dictionaryLabels.pipeline}
          selectClassName="w-full"
        />
      ),
    } as CrudField,
    {
      id: 'valueAmount',
      label: t('customers.people.detail.deals.fields.valueAmount', 'Amount'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'valueCurrency',
      label: t('customers.people.detail.deals.fields.valueCurrency', 'Currency'),
      type: 'custom',
      layout: 'half',
      component: ({ value, setValue }) => (
        <div className="space-y-1">
          <DictionaryEntrySelect
            value={typeof value === 'string' ? value : undefined}
            onChange={(next) => setValue(next ?? '')}
            fetchOptions={fetchCurrencyOptions}
            labels={currencyDictionaryLabels}
            manageHref="/backend/config/dictionaries?key=currency"
            allowInlineCreate={false}
            allowAppearance={false}
            selectClassName="w-full"
            disabled={disabled}
            showLabelInput={false}
          />
          {resolvedCurrencyError ? (
            <div className="text-xs text-muted-foreground">{resolvedCurrencyError}</div>
          ) : null}
        </div>
      ),
    } as CrudField,
    {
      id: 'probability',
      label: t('customers.people.detail.deals.fields.probability', 'Probability (%)'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'expectedCloseAt',
      label: t('customers.people.detail.deals.fields.expectedCloseAt', 'Expected close'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'description',
      label: t('customers.people.detail.deals.fields.description', 'Description'),
      type: 'textarea',
    },
    {
      id: 'personIds',
      label: t('customers.people.detail.deals.fields.people', 'People'),
      type: 'custom',
      component: ({ value, setValue, autoFocus }) => (
        <EntityMultiSelect
          value={Array.isArray(value) ? value : []}
          onChange={(next) => setValue(next)}
          placeholder={t('customers.deals.form.people.searchPlaceholder', 'Search people…')}
          emptyLabel={t('customers.deals.form.people.empty', 'No people linked yet.')}
          loadingLabel={t('customers.deals.form.people.loading', 'Searching people…')}
          noResultsLabel={t('customers.deals.form.people.noResults', 'No people match your search.')}
          removeLabel={t('customers.deals.form.assignees.remove', 'Remove')}
          errorLabel={t('customers.deals.form.people.error', 'Failed to load people.')}
          search={searchPeople}
          fetchByIds={fetchPeopleByIds}
          disabled={disabled}
          autoFocus={autoFocus}
        />
      ),
    } as CrudField,
    {
      id: 'companyIds',
      label: t('customers.people.detail.deals.fields.companies', 'Companies'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <EntityMultiSelect
          value={Array.isArray(value) ? value : []}
          onChange={(next) => setValue(next)}
          placeholder={t('customers.deals.form.companies.searchPlaceholder', 'Search companies…')}
          emptyLabel={t('customers.deals.form.companies.empty', 'No companies linked yet.')}
          loadingLabel={t('customers.deals.form.companies.loading', 'Searching companies…')}
          noResultsLabel={t('customers.deals.form.companies.noResults', 'No companies match your search.')}
          removeLabel={t('customers.deals.form.assignees.remove', 'Remove')}
          errorLabel={t('customers.deals.form.companies.error', 'Failed to load companies.')}
          search={searchCompanies}
          fetchByIds={fetchCompaniesByIds}
          disabled={disabled}
        />
      ),
    } as CrudField,
  ], [currencyDictionaryLabels, fetchCurrencyOptions, resolvedCurrencyError, dictionaryLabels.pipeline, dictionaryLabels.status, disabled, fetchCompaniesByIds, fetchPeopleByIds, searchCompanies, searchPeople, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: t('customers.people.detail.deals.form.details', 'Deal details'),
      column: 1,
      fields: ['title', 'status', 'pipelineStage', 'valueAmount', 'valueCurrency', 'probability', 'expectedCloseAt', 'description'],
    },
    {
      id: 'associations',
      title: t('customers.people.detail.deals.form.associations', 'Associations'),
      column: 1,
      fields: ['personIds', 'companyIds'],
    },
    {
      id: 'custom',
      title: t('customers.people.detail.deals.form.customFields', 'Custom fields'),
      column: 2,
      kind: 'customFields',
    },
  ], [t])

  const embeddedInitialValues = React.useMemo(() => {
    const normalizeNumber = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string') {
        const parsed = Number(value)
        return Number.isNaN(parsed) ? null : parsed
      }
      return null
    }

    const resolveIdsFromSource = (source: unknown): string[] => {
      if (Array.isArray(source)) {
        return sanitizeIdList(
          source.map((entry) => {
            if (typeof entry === 'string') return entry
            if (entry && typeof entry === 'object' && 'id' in entry && typeof (entry as any).id === 'string') {
              return (entry as any).id
            }
            return null
          }),
        )
      }
      return []
    }

    return {
      id: typeof initialValues?.id === 'string' ? initialValues.id : undefined,
      title: initialValues?.title ?? '',
      status: initialValues?.status ?? '',
      pipelineStage: initialValues?.pipelineStage ?? '',
      valueAmount: normalizeNumber(initialValues?.valueAmount ?? null),
      valueCurrency: normalizeCurrency(initialValues?.valueCurrency ?? null),
      probability: normalizeNumber(initialValues?.probability ?? null),
      expectedCloseAt: toDateInputValue(initialValues?.expectedCloseAt ?? null),
      description: initialValues?.description ?? '',
      personIds: sanitizeIdList(initialValues?.personIds ?? resolveIdsFromSource(initialValues?.people)),
      companyIds: sanitizeIdList(initialValues?.companyIds ?? resolveIdsFromSource(initialValues?.companies)),
      ...Object.fromEntries(
        Object.entries(initialValues ?? {})
          .filter(([key]) => key.startsWith('cf_'))
          .map(([key, value]) => [key, value]),
      ),
    }
  }, [initialValues])

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      if (pending || isSubmitting) return
      setPending(true)
      try {
        const parsed = schema.safeParse(values)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          const message =
            typeof issue?.message === 'string'
              ? issue.message
              : t('customers.people.detail.deals.error', 'Failed to save deal.')
          throw new Error(message)
        }
        const expectedCloseAt =
          parsed.data.expectedCloseAt && parsed.data.expectedCloseAt.length
            ? new Date(parsed.data.expectedCloseAt).toISOString()
            : undefined
        const personIds = sanitizeIdList(parsed.data.personIds)
        const companyIds = sanitizeIdList(parsed.data.companyIds)
        const base: DealFormBaseValues = {
          title: parsed.data.title,
          status: parsed.data.status || undefined,
          pipelineStage: parsed.data.pipelineStage || undefined,
          valueAmount:
            typeof parsed.data.valueAmount === 'number' ? parsed.data.valueAmount : undefined,
          valueCurrency: parsed.data.valueCurrency || undefined,
          probability:
            typeof parsed.data.probability === 'number' ? parsed.data.probability : undefined,
          expectedCloseAt,
          description: parsed.data.description && parsed.data.description.length
            ? parsed.data.description
            : undefined,
          personIds,
          companyIds,
        }
        const customEntries: Record<string, unknown> = {}
        Object.entries(values).forEach(([key, value]) => {
          if (key.startsWith('cf_')) {
            customEntries[key.slice(3)] = normalizeCustomFieldSubmitValue(value)
          }
        })
        await onSubmit({ base, custom: customEntries })
      } finally {
        setPending(false)
      }
    },
    [isSubmitting, onSubmit, pending, t],
  )

  return (
    <CrudForm<Record<string, unknown>>
      embedded
      schema={schema}
      fields={baseFields}
      groups={groups}
      entityIds={DEAL_ENTITY_IDS}
      initialValues={embeddedInitialValues}
      onSubmit={handleSubmit}
      onDelete={canDelete ? onDelete : undefined}
      deleteVisible={canDelete}
      submitLabel={
        submitLabel ??
        (mode === 'edit'
          ? t('customers.people.detail.deals.update', 'Update deal (⌘/Ctrl + Enter)')
          : t('customers.people.detail.deals.save', 'Save deal (⌘/Ctrl + Enter)'))
      }
      extraActions={(
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending || isSubmitting}
        >
          {cancelLabel ?? t('customers.people.detail.deals.cancel', 'Cancel')}
        </Button>
      )}
    />
  )
}

export default DealForm
