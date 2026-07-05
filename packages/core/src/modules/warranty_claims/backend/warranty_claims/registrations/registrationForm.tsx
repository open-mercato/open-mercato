"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudField, CrudFieldOption, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export type RegistrationRecord = {
  id: string
  serialNumber: string | null
  productName: string | null
  sku: string | null
  customerId: string | null
  orderId: string | null
  purchaseDate: string | null
  warrantyMonths: number | null
  warrantyExpiresAt: string | null
  coverageType: string | null
  source: string | null
  notes: string | null
  updatedAt: string | null
}

export type RegistrationFormValues = Partial<RegistrationRecord> & Record<string, unknown>

const COVERAGE_TYPES = ['standard', 'extended', 'none'] as const
const SOURCES = ['order', 'manual', 'third_party'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function dateInputValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed
}

function dateToIso(value: unknown): string | null {
  const dateValue = dateInputValue(value)
  if (!dateValue) return null
  const date = new Date(`${dateValue}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeOption(item: unknown): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  const label =
    toStringOrNull(item.label) ??
    toStringOrNull(item.displayName) ??
    toStringOrNull(item.display_name) ??
    toStringOrNull(item.name) ??
    id
  const email = toStringOrNull(item.primaryEmail) ?? toStringOrNull(item.primary_email)
  return { value: id, label: email ? `${label} (${email})` : label }
}

export function normalizeRegistration(value: unknown): RegistrationRecord | null {
  if (!isRecord(value)) return null
  const id = toStringOrNull(value.id)
  if (!id) return null
  return {
    id,
    serialNumber: toStringOrNull(value.serialNumber),
    productName: toStringOrNull(value.productName),
    sku: toStringOrNull(value.sku),
    customerId: toStringOrNull(value.customerId),
    orderId: toStringOrNull(value.orderId),
    purchaseDate: dateInputValue(value.purchaseDate) || null,
    warrantyMonths: toNumberOrNull(value.warrantyMonths),
    warrantyExpiresAt: toStringOrNull(value.warrantyExpiresAt),
    coverageType: toStringOrNull(value.coverageType),
    source: toStringOrNull(value.source),
    notes: toStringOrNull(value.notes),
    updatedAt: toStringOrNull(value.updatedAt),
  }
}

function nullableText(value: unknown): string | null {
  return toStringOrNull(value)
}

function nullableInteger(value: unknown): number | null {
  const parsed = toNumberOrNull(value)
  if (parsed === null) return null
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export function buildRegistrationPayload(values: RegistrationFormValues, id?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (id) payload.id = id
  payload.serialNumber = nullableText(values.serialNumber)
  payload.productName = nullableText(values.productName)
  payload.sku = nullableText(values.sku)
  payload.customerId = nullableText(values.customerId)
  payload.orderId = nullableText(values.orderId)
  payload.purchaseDate = dateToIso(values.purchaseDate)
  payload.warrantyMonths = nullableInteger(values.warrantyMonths)
  payload.coverageType = nullableText(values.coverageType)
  payload.source = nullableText(values.source)
  payload.notes = nullableText(values.notes)
  return payload
}

function coverageLabel(t: TranslateFn, value: string): string {
  if (value === 'standard') return t('warranty_claims.registrations.coverageType.standard', 'Standard')
  if (value === 'extended') return t('warranty_claims.registrations.coverageType.extended', 'Extended')
  return t('warranty_claims.registrations.coverageType.none', 'No coverage')
}

function sourceLabel(t: TranslateFn, value: string): string {
  if (value === 'order') return t('warranty_claims.registrations.source.order', 'Order')
  if (value === 'manual') return t('warranty_claims.registrations.source.manual', 'Manual')
  return t('warranty_claims.registrations.source.thirdParty', 'Third party')
}

export function useRegistrationFormConfig(
  t: TranslateFn,
  registration?: RegistrationRecord | null,
): { fields: CrudField[]; groups: CrudFormGroup[] } {
  const loadCustomerOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '20' })
    const trimmed = query?.trim()
    if (trimmed) params.set('search', trimmed)
    const [people, companies] = await Promise.all([
      apiCall<{ items?: unknown[] }>(`/api/customers/people?${params.toString()}`, undefined, { fallback: { items: [] } }),
      apiCall<{ items?: unknown[] }>(`/api/customers/companies?${params.toString()}`, undefined, { fallback: { items: [] } }),
    ])
    const items = [
      ...(Array.isArray(people.result?.items) ? people.result.items : []),
      ...(Array.isArray(companies.result?.items) ? companies.result.items : []),
    ]
    return items.map(normalizeOption).filter((option): option is CrudFieldOption => option !== null)
  }, [])

  const customerSeedOptions = React.useMemo<CrudFieldOption[]>(() => {
    if (!registration?.customerId) return []
    return [{ value: registration.customerId, label: registration.customerId }]
  }, [registration?.customerId])

  const coverageOptions = React.useMemo<CrudFieldOption[]>(
    () => COVERAGE_TYPES.map((value) => ({ value, label: coverageLabel(t, value) })),
    [t],
  )

  const sourceOptions = React.useMemo<CrudFieldOption[]>(
    () => SOURCES.map((value) => ({ value, label: sourceLabel(t, value) })),
    [t],
  )

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'serialNumber',
      label: t('warranty_claims.registrations.form.serialNumber', 'Serial number'),
      type: 'text',
    },
    {
      id: 'productName',
      label: t('warranty_claims.registrations.form.productName', 'Product name'),
      type: 'text',
    },
    {
      id: 'sku',
      label: t('warranty_claims.registrations.form.sku', 'SKU'),
      type: 'text',
    },
    {
      id: 'customerId',
      label: t('warranty_claims.registrations.form.customerId', 'Customer'),
      type: 'combobox',
      loadOptions: loadCustomerOptions,
      seedOptions: customerSeedOptions,
      allowCustomValues: false,
      placeholder: t('warranty_claims.registrations.form.customerId.placeholder', 'Search customers'),
    },
    {
      id: 'orderId',
      label: t('warranty_claims.registrations.form.orderId', 'Order ID'),
      type: 'text',
    },
    {
      id: 'purchaseDate',
      label: t('warranty_claims.registrations.form.purchaseDate', 'Purchase date'),
      type: 'date',
    },
    {
      id: 'warrantyMonths',
      label: t('warranty_claims.registrations.form.warrantyMonths', 'Warranty months'),
      type: 'number',
    },
    {
      id: 'coverageType',
      label: t('warranty_claims.registrations.form.coverageType', 'Coverage type'),
      type: 'select',
      options: coverageOptions,
    },
    {
      id: 'source',
      label: t('warranty_claims.registrations.form.source', 'Source'),
      type: 'select',
      options: sourceOptions,
    },
    {
      id: 'notes',
      label: t('warranty_claims.registrations.form.notes', 'Notes'),
      type: 'textarea',
      rows: 5,
      layout: 'full',
    },
  ], [coverageOptions, customerSeedOptions, loadCustomerOptions, sourceOptions, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'product',
      title: t('warranty_claims.registrations.form.group.product', 'Product'),
      fields: ['serialNumber', 'productName', 'sku'],
    },
    {
      id: 'ownership',
      title: t('warranty_claims.registrations.form.group.ownership', 'Ownership'),
      fields: ['customerId', 'orderId'],
    },
    {
      id: 'coverage',
      title: t('warranty_claims.registrations.form.group.coverage', 'Coverage'),
      fields: ['purchaseDate', 'warrantyMonths', 'coverageType', 'source'],
    },
    {
      id: 'notes',
      title: t('warranty_claims.registrations.form.group.notes', 'Notes'),
      fields: ['notes'],
    },
  ], [t])

  return { fields, groups }
}
