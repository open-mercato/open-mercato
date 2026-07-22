"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { LookupSelect } from '@open-mercato/ui/backend/inputs'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Plus, Trash2 } from 'lucide-react'
import {
  EUDR_ACTIVITY_TYPES,
  EUDR_ACTOR_ROLES,
  EUDR_COMMODITIES,
  EUDR_STATEMENT_STATUSES,
  EUDR_SUBMISSION_STATUSES,
  GEOJSON_TYPES,
  type EudrActivityType,
  type EudrActorRole,
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

export type OrderSnapshot = {
  orderNumber?: string | null
}

export type ReferencedStatementValue = {
  referenceNumber: string
  verificationNumber?: string
}

export type PickerOption<Snapshot extends Record<string, unknown>> = {
  value: string
  label: string
  subtitle?: string | null
  snapshot?: Snapshot | null
  unavailable?: boolean
}

type PickerPayload = {
  items?: unknown[]
}

type LookupSelectFieldProps<Snapshot extends Record<string, unknown>> = {
  id: string
  value?: string | null
  onChange: (value: string | undefined) => void
  onSnapshot?: (snapshot: Snapshot | null) => void
  placeholder: string
  emptyLabel?: string
  loadError: string
  disabled?: boolean
  loadOptions: (search: string) => Promise<PickerOption<Snapshot>[]>
  loadSelectedOption?: (id: string) => Promise<PickerOption<Snapshot> | null>
}

const GEOJSON_SIZE_LIMIT = 1_048_576
export const PICKER_PAGE_SIZE = 20

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

export function activityTypeOptions(translate: Translator): Array<{ value: EudrActivityType; label: string }> {
  return EUDR_ACTIVITY_TYPES.map((activityType) => ({
    value: activityType,
    label: translate(`eudr.activityType.${activityType}`),
  }))
}

export function actorRoleOptions(translate: Translator): Array<{ value: EudrActorRole; label: string }> {
  return EUDR_ACTOR_ROLES.map((actorRole) => ({
    value: actorRole,
    label: translate(`eudr.actorRole.${actorRole}`),
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

function normalizeProductOption(raw: unknown): PickerOption<ProductSnapshot> | null {
  if (!isRecord(raw)) return null
  const id = readString(raw, ['id'])
  if (!id) return null
  const title = readString(raw, ['title'])
  const sku = readString(raw, ['sku'])
  if (!title && !sku) return null
  const snapshot = {
    ...(title ? { name: title } : {}),
    ...(sku ? { sku } : {}),
  }
  return { value: id, label: title ?? sku ?? '', subtitle: title ? sku : null, snapshot }
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
  const commodity = readString(raw, ['commodity'])
  const hsCode = readString(raw, ['hsCode'])
  const label = productName ?? productSku ?? translate('eudr.common.recordUnavailable')
  const subtitleSegments = [
    productName ? productSku : null,
    commodity ? translate(`eudr.commodity.${commodity}`) : null,
    hsCode,
  ].filter((segment): segment is string => typeof segment === 'string' && segment.length > 0)
  return { value: id, label, subtitle: subtitleSegments.length ? subtitleSegments.join(' - ') : null }
}

function normalizeStatementOption(raw: unknown, translate: Translator): PickerOption<Record<string, unknown>> | null {
  if (!isRecord(raw)) return null
  const id = readString(raw, ['id'])
  if (!id) return null
  const title = readString(raw, ['title'])
  const referenceNumber = readString(raw, ['referenceNumber'])
  const label = title ?? referenceNumber ?? translate('eudr.common.recordUnavailable')
  return { value: id, label, subtitle: title ? referenceNumber : null }
}

export function LookupSelectField<Snapshot extends Record<string, unknown>>({
  id,
  value,
  onChange,
  onSnapshot,
  placeholder,
  loadError,
  disabled,
  loadOptions,
  loadSelectedOption,
}: LookupSelectFieldProps<Snapshot>) {
  const translate = useT()
  const selectedValue = typeof value === 'string' && value.length > 0 ? value : null
  const [selectedOption, setSelectedOption] = React.useState<PickerOption<Snapshot> | null>(null)
  const knownOptionsRef = React.useRef<Map<string, PickerOption<Snapshot>>>(new Map())

  React.useEffect(() => {
    if (!selectedValue) {
      setSelectedOption(null)
      return
    }
    if (selectedOption?.value === selectedValue) return
    const known = knownOptionsRef.current.get(selectedValue)
    if (known) {
      setSelectedOption(known)
      return
    }
    let cancelled = false
    const markUnavailable = () => {
      if (!cancelled) {
        setSelectedOption({
          value: selectedValue,
          label: translate('eudr.common.recordUnavailable'),
          unavailable: true,
        })
      }
    }
    if (!loadSelectedOption) {
      markUnavailable()
      return
    }
    loadSelectedOption(selectedValue)
      .then((resolved) => {
        if (cancelled) return
        if (resolved) {
          knownOptionsRef.current.set(resolved.value, resolved)
          setSelectedOption(resolved)
        } else {
          markUnavailable()
        }
      })
      .catch(markUnavailable)
    return () => {
      cancelled = true
    }
  }, [loadSelectedOption, selectedOption, selectedValue, translate])

  React.useEffect(() => {
    if (!onSnapshot || !selectedOption || selectedOption.unavailable) return
    onSnapshot(selectedOption.snapshot ?? null)
  }, [onSnapshot, selectedOption])

  const selectedOptionRef = React.useRef(selectedOption)
  React.useEffect(() => {
    selectedOptionRef.current = selectedOption
  }, [selectedOption])

  const setQueryRef = React.useRef<((value: string) => void) | null>(null)

  const fetchItems = React.useCallback(async (query: string) => {
    let options: Array<PickerOption<Snapshot>> = []
    try {
      options = await loadOptions(query)
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : loadError
      flash(message, 'error')
      options = []
    }
    for (const option of options) knownOptionsRef.current.set(option.value, option)
    const selected = selectedOptionRef.current
    const merged = selected && !options.some((option) => option.value === selected.value)
      ? [selected, ...options]
      : options
    return merged.map((option) => ({
      id: option.value,
      title: option.label,
      subtitle: option.subtitle ?? undefined,
    }))
  }, [loadError, loadOptions])

  return (
    <div id={id} className="space-y-2">
      {selectedValue ? (
        <p className="text-sm text-foreground">
          <span className="font-medium">{selectedOption?.label ?? ''}</span>
          {selectedOption?.subtitle ? (
            <span className="text-muted-foreground"> — {selectedOption.subtitle}</span>
          ) : null}
        </p>
      ) : null}
      <LookupSelect
        value={selectedValue}
        disabled={disabled}
        searchPlaceholder={placeholder}
        fetchItems={fetchItems}
        onReady={(controls) => { setQueryRef.current = controls.setQuery }}
        onChange={(nextValue) => {
          if (!nextValue) {
            onChange(undefined)
            onSnapshot?.(null)
            setSelectedOption(null)
            return
          }
          onChange(nextValue)
          const nextOption = knownOptionsRef.current.get(nextValue) ?? null
          setSelectedOption(nextOption)
          onSnapshot?.(nextOption?.snapshot ?? null)
          // Clearing the query drops LookupSelect back below its minQuery, which
          // collapses the result panel — otherwise it stays open over the form.
          setQueryRef.current?.('')
        }}
      />
    </div>
  )
}

export function ProductSelectField({
  id,
  value,
  onChange,
  onSnapshot,
  placeholder,
  loadError,
}: Omit<LookupSelectFieldProps<ProductSnapshot>, 'loadOptions' | 'loadSelectedOption' | 'emptyLabel'>) {
  const loadProductOptions = React.useCallback(async (search: string) => {
    const params = new URLSearchParams({ page: '1', pageSize: String(PICKER_PAGE_SIZE) })
    if (search) params.set('search', search)
    const payload = await readApiResultOrThrow<PickerPayload>(
      `/api/catalog/products?${params.toString()}`,
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
    <LookupSelectField
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
}: Omit<LookupSelectFieldProps<CompanySnapshot>, 'loadOptions' | 'loadSelectedOption' | 'emptyLabel'>) {
  const loadCompanyOptions = React.useCallback(async (search: string) => {
    const params = new URLSearchParams({
      page: '1',
      pageSize: String(PICKER_PAGE_SIZE),
      sortField: 'name',
      sortDir: 'asc',
    })
    if (search) params.set('search', search)
    const payload = await readApiResultOrThrow<PickerPayload>(
      `/api/customers/companies?${params.toString()}`,
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
    <LookupSelectField
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

function collectProductIds(items: unknown[]): string[] {
  const ids: string[] = []
  for (const item of items) {
    if (!isRecord(item)) continue
    const id = readString(item, ['id'])
    if (id) ids.push(id)
  }
  return ids
}

export function MappingSelectField({
  id,
  value,
  onChange,
  placeholder,
  loadError,
}: Omit<LookupSelectFieldProps<Record<string, unknown>>, 'loadOptions' | 'loadSelectedOption' | 'onSnapshot'>) {
  const translate = useT()
  const loadMappingOptions = React.useCallback(async (search: string) => {
    const mappingParams = new URLSearchParams({ page: '1', pageSize: String(PICKER_PAGE_SIZE) })
    if (!search) {
      const payload = await readApiResultOrThrow<PickerPayload>(
        `/api/eudr/product-mappings?${mappingParams.toString()}`,
        undefined,
        { errorMessage: loadError },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      return items
        .map((item) => normalizeMappingOption(item, translate))
        .filter((option): option is PickerOption<Record<string, unknown>> => option !== null)
    }
    const productParams = new URLSearchParams({ page: '1', pageSize: String(PICKER_PAGE_SIZE), search })
    const directParams = new URLSearchParams({ page: '1', pageSize: String(PICKER_PAGE_SIZE), search })
    const [productsPayload, directPayload] = await Promise.all([
      readApiResultOrThrow<PickerPayload>(
        `/api/catalog/products?${productParams.toString()}`,
        undefined,
        { errorMessage: loadError },
      ),
      readApiResultOrThrow<PickerPayload>(
        `/api/eudr/product-mappings?${directParams.toString()}`,
        undefined,
        { errorMessage: loadError },
      ),
    ])
    const productIds = collectProductIds(Array.isArray(productsPayload.items) ? productsPayload.items : [])
    let byProductItems: unknown[] = []
    if (productIds.length) {
      const byProductParams = new URLSearchParams({
        page: '1',
        pageSize: String(PICKER_PAGE_SIZE),
        productId: productIds.join(','),
      })
      const byProductPayload = await readApiResultOrThrow<PickerPayload>(
        `/api/eudr/product-mappings?${byProductParams.toString()}`,
        undefined,
        { errorMessage: loadError },
      )
      byProductItems = Array.isArray(byProductPayload.items) ? byProductPayload.items : []
    }
    const directItems = Array.isArray(directPayload.items) ? directPayload.items : []
    const merged = new Map<string, PickerOption<Record<string, unknown>>>()
    for (const item of [...byProductItems, ...directItems]) {
      const option = normalizeMappingOption(item, translate)
      if (option && !merged.has(option.value)) merged.set(option.value, option)
    }
    return Array.from(merged.values())
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
    <LookupSelectField
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
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
  loadError,
}: Omit<LookupSelectFieldProps<Record<string, unknown>>, 'loadOptions' | 'loadSelectedOption' | 'onSnapshot'>) {
  const translate = useT()
  const loadStatementOptions = React.useCallback(async (search: string) => {
    const params = new URLSearchParams({ page: '1', pageSize: String(PICKER_PAGE_SIZE) })
    if (search) params.set('search', search)
    const payload = await readApiResultOrThrow<PickerPayload>(
      `/api/eudr/statements?${params.toString()}`,
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
    <LookupSelectField
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      loadError={loadError}
      loadOptions={loadStatementOptions}
      loadSelectedOption={loadSelectedStatement}
    />
  )
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

function normalizeReferencedStatements(value: unknown): ReferencedStatementValue[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!isRecord(entry)) return null
      const referenceNumber = readString(entry, ['referenceNumber']) ?? ''
      const verificationNumber = readString(entry, ['verificationNumber']) ?? ''
      return verificationNumber
        ? { referenceNumber, verificationNumber }
        : { referenceNumber }
    })
    .filter((entry): entry is ReferencedStatementValue => entry !== null)
}

export function ReferencedStatementsField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: ReferencedStatementValue[] | unknown
  onChange: (value: ReferencedStatementValue[]) => void
  disabled?: boolean
}) {
  const translate = useT()
  const rows = React.useMemo(() => normalizeReferencedStatements(value), [value])
  const hasIncompleteRows = rows.some((row) => row.referenceNumber.trim().length === 0)

  const updateRow = React.useCallback((index: number, patch: Partial<ReferencedStatementValue>) => {
    const nextRows = rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const referenceNumber = patch.referenceNumber ?? row.referenceNumber
      const verificationNumber = patch.verificationNumber ?? row.verificationNumber ?? ''
      return verificationNumber.trim()
        ? { referenceNumber, verificationNumber }
        : { referenceNumber }
    })
    onChange(nextRows)
  }, [onChange, rows])

  const removeRow = React.useCallback((index: number) => {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index))
  }, [onChange, rows])

  return (
    <div id={id} className="space-y-3">
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <Input
                value={row.referenceNumber}
                disabled={disabled}
                placeholder={translate('eudr.statements.form.referenceNumber')}
                onChange={(event) => updateRow(index, { referenceNumber: event.target.value })}
              />
              <Input
                value={row.verificationNumber ?? ''}
                disabled={disabled}
                placeholder={translate('eudr.statements.form.verificationNumber')}
                onChange={(event) => updateRow(index, { verificationNumber: event.target.value })}
              />
              <IconButton
                type="button"
                variant="ghost"
                disabled={disabled}
                aria-label={translate('eudr.statements.form.removeReferencedStatement')}
                onClick={() => removeRow(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate('eudr.statements.form.noReferencedStatements')}
        </p>
      )}
      {hasIncompleteRows ? (
        <p className="text-sm text-status-warning-text">
          {translate('eudr.statements.form.referencedStatementsValidation')}
        </p>
      ) : null}
      <IconButton
        type="button"
        variant="outline"
        disabled={disabled}
        aria-label={translate('eudr.statements.form.addReferencedStatement')}
        onClick={() => onChange([...rows, { referenceNumber: '' }])}
      >
        <Plus className="size-4" aria-hidden="true" />
      </IconButton>
    </div>
  )
}

export { CountrySelectField } from './CountrySelectField'
export { OrderSelectField } from './OrderSelectField'
export { PlotMultiSelectField } from './PlotMultiSelectField'
