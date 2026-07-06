"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import {
  EUDR_COMMODITIES,
  EUDR_STATEMENT_STATUSES,
  EUDR_SUBMISSION_STATUSES,
  GEOJSON_TYPES,
  type EudrCommodity,
  type EudrStatementStatus,
  type EudrSubmissionStatus,
} from '../data/validators'

export type Translator = (
  key: string,
  fallbackOrParams?: string | Record<string, string | number>,
  params?: Record<string, string | number>,
) => string

export type ProductSnapshot = {
  name?: string
  sku?: string
}

export type CompanySnapshot = {
  displayName?: string
}

type PickerOption<Snapshot extends Record<string, unknown>> = {
  value: string
  label: string
  snapshot?: Snapshot | null
}

type PickerPayload = {
  items?: unknown[]
}

type AsyncSelectFieldProps<Snapshot extends Record<string, unknown>> = {
  id: string
  value?: string | null
  onChange: (value: string | undefined) => void
  onSnapshot?: (snapshot: Snapshot | null) => void
  placeholder: string
  emptyLabel?: string
  loadError: string
  loadOptions: () => Promise<PickerOption<Snapshot>[]>
  loadSelectedOption?: (id: string) => Promise<PickerOption<Snapshot> | null>
}

const EMPTY_OPTION_VALUE = '__eudr_empty__'
const GEOJSON_SIZE_LIMIT = 1_048_576

export function commodityOptions(translate: Translator): Array<{ value: EudrCommodity; label: string }> {
  return EUDR_COMMODITIES.map((commodity) => ({
    value: commodity,
    label: translate(`eudr.commodity.${commodity}`),
  }))
}

export function submissionStatusOptions(translate: Translator): Array<{ value: EudrSubmissionStatus; label: string }> {
  return EUDR_SUBMISSION_STATUSES.map((status) => ({
    value: status,
    label: translate(`eudr.submissionStatus.${status}`),
  }))
}

export function statementStatusOptions(translate: Translator): Array<{ value: EudrStatementStatus; label: string }> {
  return EUDR_STATEMENT_STATUSES.map((status) => ({
    value: status,
    label: translate(`eudr.statementStatus.${status}`),
  }))
}

export function statusBadgeVariant(
  status: EudrSubmissionStatus | EudrStatementStatus | string | null | undefined,
): StatusBadgeVariant {
  if (status === 'submitted') return 'info'
  if (status === 'verified' || status === 'available') return 'success'
  if (status === 'rejected') return 'error'
  if (status === 'withdrawn') return 'warning'
  return 'neutral'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function mergeOptions<Snapshot extends Record<string, unknown>>(
  options: Array<PickerOption<Snapshot>>,
  selected: PickerOption<Snapshot> | null,
): Array<PickerOption<Snapshot>> {
  if (!selected) return options
  if (options.some((option) => option.value === selected.value)) return options
  return [selected, ...options]
}

function normalizeProductOption(raw: unknown): PickerOption<ProductSnapshot> | null {
  if (!isRecord(raw)) return null
  const id = readString(raw, ['id'])
  if (!id) return null
  const title = readString(raw, ['title'])
  const sku = readString(raw, ['sku'])
  const label = title && sku ? `${title} (${sku})` : title ?? sku ?? id
  const snapshot = title || sku
    ? {
        ...(title ? { name: title } : {}),
        ...(sku ? { sku } : {}),
      }
    : null
  return { value: id, label, snapshot }
}

function normalizeCompanyOption(raw: unknown): PickerOption<CompanySnapshot> | null {
  if (!isRecord(raw)) return null
  const id = readString(raw, ['id'])
  if (!id) return null
  const displayName = readString(raw, ['display_name', 'displayName', 'name'])
  if (!displayName) return null
  return {
    value: id,
    label: displayName,
    snapshot: { displayName },
  }
}

function normalizeMappingOption(raw: unknown, translate: Translator): PickerOption<Record<string, unknown>> | null {
  if (!isRecord(raw)) return null
  const id = readString(raw, ['id'])
  if (!id) return null
  const productSnapshot = isRecord(raw.productSnapshot) ? raw.productSnapshot : null
  const productName = productSnapshot ? readString(productSnapshot, ['name']) : null
  const productSku = productSnapshot ? readString(productSnapshot, ['sku']) : null
  const productId = readString(raw, ['productId'])
  const commodity = readString(raw, ['commodity'])
  const hsCode = readString(raw, ['hsCode'])
  const productLabel = productName && productSku ? `${productName} (${productSku})` : productName ?? productSku ?? productId
  const segments = [
    productLabel,
    commodity ? translate(`eudr.commodity.${commodity}`) : null,
    hsCode,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  return { value: id, label: segments.length ? segments.join(' - ') : id }
}

function normalizeStatementOption(raw: unknown, translate: Translator): PickerOption<Record<string, unknown>> | null {
  if (!isRecord(raw)) return null
  const id = readString(raw, ['id'])
  if (!id) return null
  const title = readString(raw, ['title'])
  const referenceNumber = readString(raw, ['referenceNumber'])
  const commodity = readString(raw, ['commodity'])
  const segments = [
    title ?? referenceNumber,
    commodity ? translate(`eudr.commodity.${commodity}`) : null,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  return { value: id, label: segments.length ? segments.join(' - ') : id }
}

function sortOptions<Snapshot extends Record<string, unknown>>(
  options: Array<PickerOption<Snapshot>>,
): Array<PickerOption<Snapshot>> {
  return [...options].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }),
  )
}

function AsyncSelectField<Snapshot extends Record<string, unknown>>({
  id,
  value,
  onChange,
  onSnapshot,
  placeholder,
  emptyLabel,
  loadError,
  loadOptions,
  loadSelectedOption,
}: AsyncSelectFieldProps<Snapshot>) {
  const [options, setOptions] = React.useState<Array<PickerOption<Snapshot>>>([])
  const [loading, setLoading] = React.useState(true)
  const selectedValue = typeof value === 'string' && value.length > 0 ? value : undefined
  const selectedOption = selectedValue ? options.find((option) => option.value === selectedValue) : null
  const selectValue = selectedValue ?? (emptyLabel ? EMPTY_OPTION_VALUE : undefined)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const loadedOptions = await loadOptions()
        const selected = selectedValue && !loadedOptions.some((option) => option.value === selectedValue) && loadSelectedOption
          ? await loadSelectedOption(selectedValue).catch(() => null)
          : null
        if (!cancelled) setOptions(mergeOptions(sortOptions(loadedOptions), selected))
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error && error.message ? error.message : loadError
          flash(message, 'error')
          setOptions([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [loadError, loadOptions, loadSelectedOption, selectedValue])

  React.useEffect(() => {
    if (!selectedValue || !loadSelectedOption) return
    if (options.some((option) => option.value === selectedValue)) return
    let cancelled = false
    loadSelectedOption(selectedValue)
      .then((selected) => {
        if (!cancelled) setOptions((current) => mergeOptions(current, selected))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [loadSelectedOption, options, selectedValue])

  React.useEffect(() => {
    if (!onSnapshot || !selectedOption) return
    onSnapshot(selectedOption.snapshot ?? null)
  }, [onSnapshot, selectedOption])

  return (
    <Select
      value={selectValue}
      onValueChange={(nextValue) => {
        if (nextValue === EMPTY_OPTION_VALUE) {
          onChange(undefined)
          onSnapshot?.(null)
          return
        }
        onChange(nextValue)
        const nextOption = options.find((option) => option.value === nextValue)
        onSnapshot?.(nextOption?.snapshot ?? null)
      }}
      disabled={loading}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder}>{selectedOption?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {emptyLabel ? (
          <SelectItem value={EMPTY_OPTION_VALUE}>{emptyLabel}</SelectItem>
        ) : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ProductSelectField({
  id,
  value,
  onChange,
  onSnapshot,
  placeholder,
  loadError,
}: Omit<AsyncSelectFieldProps<ProductSnapshot>, 'loadOptions' | 'loadSelectedOption' | 'emptyLabel'>) {
  const loadProductOptions = React.useCallback(async () => {
    const payload = await readApiResultOrThrow<PickerPayload>(
      '/api/catalog/products?pageSize=100',
      undefined,
      { errorMessage: loadError },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => normalizeProductOption(item))
      .filter((option): option is PickerOption<ProductSnapshot> => option !== null)
  }, [loadError])

  const loadSelectedProduct = React.useCallback(async (productId: string) => {
    const payload = await readApiResultOrThrow<PickerPayload>(
      `/api/catalog/products?id=${encodeURIComponent(productId)}&pageSize=1`,
      undefined,
      { errorMessage: loadError },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => normalizeProductOption(item))
      .find((option): option is PickerOption<ProductSnapshot> => option?.value === productId) ?? null
  }, [loadError])

  return (
    <AsyncSelectField
      id={id}
      value={value}
      onChange={onChange}
      onSnapshot={onSnapshot}
      placeholder={placeholder}
      loadError={loadError}
      loadOptions={loadProductOptions}
      loadSelectedOption={loadSelectedProduct}
    />
  )
}

export function CompanySelectField({
  id,
  value,
  onChange,
  onSnapshot,
  placeholder,
  loadError,
}: Omit<AsyncSelectFieldProps<CompanySnapshot>, 'loadOptions' | 'loadSelectedOption' | 'emptyLabel'>) {
  const loadCompanyOptions = React.useCallback(async () => {
    const payload = await readApiResultOrThrow<PickerPayload>(
      '/api/customers/companies?pageSize=100&sortField=name&sortDir=asc',
      undefined,
      { errorMessage: loadError },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => normalizeCompanyOption(item))
      .filter((option): option is PickerOption<CompanySnapshot> => option !== null)
  }, [loadError])

  const loadSelectedCompany = React.useCallback(async (companyId: string) => {
    const payload = await readApiResultOrThrow<PickerPayload>(
      `/api/customers/companies?id=${encodeURIComponent(companyId)}&pageSize=1`,
      undefined,
      { errorMessage: loadError },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => normalizeCompanyOption(item))
      .find((option): option is PickerOption<CompanySnapshot> => option?.value === companyId) ?? null
  }, [loadError])

  return (
    <AsyncSelectField
      id={id}
      value={value}
      onChange={onChange}
      onSnapshot={onSnapshot}
      placeholder={placeholder}
      loadError={loadError}
      loadOptions={loadCompanyOptions}
      loadSelectedOption={loadSelectedCompany}
    />
  )
}

export function MappingSelectField({
  id,
  value,
  onChange,
  placeholder,
  emptyLabel,
  loadError,
}: Omit<AsyncSelectFieldProps<Record<string, unknown>>, 'loadOptions' | 'loadSelectedOption' | 'onSnapshot'>) {
  const translate = useT()
  const loadMappingOptions = React.useCallback(async () => {
    const payload = await readApiResultOrThrow<PickerPayload>(
      '/api/eudr/product-mappings?pageSize=100',
      undefined,
      { errorMessage: loadError },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => normalizeMappingOption(item, translate))
      .filter((option): option is PickerOption<Record<string, unknown>> => option !== null)
  }, [loadError, translate])

  const loadSelectedMapping = React.useCallback(async (mappingId: string) => {
    const payload = await readApiResultOrThrow<PickerPayload>(
      `/api/eudr/product-mappings?id=${encodeURIComponent(mappingId)}&pageSize=1`,
      undefined,
      { errorMessage: loadError },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => normalizeMappingOption(item, translate))
      .find((option): option is PickerOption<Record<string, unknown>> => option?.value === mappingId) ?? null
  }, [loadError, translate])

  return (
    <AsyncSelectField
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      emptyLabel={emptyLabel}
      loadError={loadError}
      loadOptions={loadMappingOptions}
      loadSelectedOption={loadSelectedMapping}
    />
  )
}

export function StatementSelectField({
  id,
  value,
  onChange,
  placeholder,
  emptyLabel,
  loadError,
}: Omit<AsyncSelectFieldProps<Record<string, unknown>>, 'loadOptions' | 'loadSelectedOption' | 'onSnapshot'>) {
  const translate = useT()
  const loadStatementOptions = React.useCallback(async () => {
    const payload = await readApiResultOrThrow<PickerPayload>(
      '/api/eudr/statements?pageSize=100',
      undefined,
      { errorMessage: loadError },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => normalizeStatementOption(item, translate))
      .filter((option): option is PickerOption<Record<string, unknown>> => option !== null)
  }, [loadError, translate])

  const loadSelectedStatement = React.useCallback(async (statementId: string) => {
    const payload = await readApiResultOrThrow<PickerPayload>(
      `/api/eudr/statements?id=${encodeURIComponent(statementId)}&pageSize=1`,
      undefined,
      { errorMessage: loadError },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => normalizeStatementOption(item, translate))
      .find((option): option is PickerOption<Record<string, unknown>> => option?.value === statementId) ?? null
  }, [loadError, translate])

  return (
    <AsyncSelectField
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      emptyLabel={emptyLabel}
      loadError={loadError}
      loadOptions={loadStatementOptions}
      loadSelectedOption={loadSelectedStatement}
    />
  )
}

export function parseAttachmentIdsInput(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

export function formatAttachmentIds(ids: string[] | null | undefined): string {
  return Array.isArray(ids) ? ids.join('\n') : ''
}

export function parseGeolocationInput(raw: string, translate: Translator): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    const message = translate('eudr.errors.geolocationInvalid')
    throw createCrudFormError(message, { geolocation: message })
  }

  if (!isRecord(parsed)) {
    const message = translate('eudr.errors.geolocationInvalid')
    throw createCrudFormError(message, { geolocation: message })
  }

  const geoJsonType = parsed.type
  if (
    typeof geoJsonType !== 'string' ||
    !GEOJSON_TYPES.some((allowedType) => allowedType === geoJsonType)
  ) {
    const message = translate('eudr.errors.geolocationInvalid')
    throw createCrudFormError(message, { geolocation: message })
  }

  if (JSON.stringify(parsed).length > GEOJSON_SIZE_LIMIT) {
    const message = translate('eudr.errors.geolocationTooLarge')
    throw createCrudFormError(message, { geolocation: message })
  }

  return parsed
}
