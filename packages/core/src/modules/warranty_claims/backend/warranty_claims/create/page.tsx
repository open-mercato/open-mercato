"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ClaimCreateFormValues = {
  claimType: string
  customerId?: string | null
  orderId?: string | null
  priority: string
  reasonCode?: string | null
  notes?: string | null
  productName?: string | null
  sku?: string | null
  serialNumber?: string | null
  faultCode?: string | null
  faultDescription?: string | null
  qtyClaimed?: number | string | null
}

type DictionaryListItem = {
  id?: string
  key?: string
}

type DictionaryEntriesResponse = {
  items?: unknown[]
}

const CLAIM_TYPES = ['warranty', 'return', 'core_return', 'vendor_recovery'] as const
const CLAIM_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const DICTIONARY_KEYS = {
  faultCodes: 'warranty_claims.warranty_claim_fault_code',
  claimReasons: 'warranty_claims.warranty_claim_reason',
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
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

function normalizeDictionaryOption(item: unknown): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const value = toStringOrNull(item.value)
  if (!value) return null
  const label = toStringOrNull(item.label) ?? value
  return { value, label }
}

function nullableText(value: unknown): string | null {
  const next = toStringOrNull(value)
  return next ?? null
}

export default function CreateWarrantyClaimPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()

  const loadDictionaryOptions = React.useCallback(async (dictionaryKey: string): Promise<CrudFieldOption[]> => {
    const dictionaries = await readApiResultOrThrow<{ items?: DictionaryListItem[] }>(
      '/api/dictionaries',
      undefined,
      {
        fallback: { items: [] },
        errorMessage: t('warranty_claims.form.error.dictionaryLoad'),
      },
    )
    const dictionary = (dictionaries.items ?? []).find((item) => item.key === dictionaryKey)
    if (!dictionary?.id) return []
    const entries = await readApiResultOrThrow<DictionaryEntriesResponse>(
      `/api/dictionaries/${encodeURIComponent(dictionary.id)}/entries`,
      undefined,
      {
        fallback: { items: [] },
        errorMessage: t('warranty_claims.form.error.dictionaryLoad'),
      },
    )
    return (entries.items ?? [])
      .map(normalizeDictionaryOption)
      .filter((option): option is CrudFieldOption => option !== null)
  }, [t])

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

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'claimType',
      label: t('warranty_claims.form.claimType'),
      type: 'select',
      required: true,
      options: CLAIM_TYPES.map((claimType) => ({
        value: claimType,
        label: t(`warranty_claims.claimType.${claimType}`),
      })),
    },
    {
      id: 'customerId',
      label: t('warranty_claims.form.customerId'),
      type: 'combobox',
      loadOptions: loadCustomerOptions,
      allowCustomValues: false,
      placeholder: t('warranty_claims.form.customerId.placeholder'),
      seedOptions: [],
    },
    {
      id: 'orderId',
      label: t('warranty_claims.form.orderId'),
      type: 'text',
      placeholder: t('warranty_claims.form.orderId.placeholder'),
    },
    {
      id: 'priority',
      label: t('warranty_claims.form.priority'),
      type: 'select',
      required: true,
      options: CLAIM_PRIORITIES.map((priority) => ({
        value: priority,
        label: t(`warranty_claims.priority.${priority}`),
      })),
    },
    {
      id: 'reasonCode',
      label: t('warranty_claims.form.reasonCode'),
      type: 'select',
      loadOptions: () => loadDictionaryOptions(DICTIONARY_KEYS.claimReasons),
    },
    {
      id: 'notes',
      label: t('warranty_claims.form.notes'),
      type: 'textarea',
      rows: 4,
      layout: 'full',
    },
    {
      id: 'productName',
      label: t('warranty_claims.form.productName'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'sku',
      label: t('warranty_claims.form.sku'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'serialNumber',
      label: t('warranty_claims.form.serialNumber'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'faultCode',
      label: t('warranty_claims.form.faultCode'),
      type: 'select',
      loadOptions: () => loadDictionaryOptions(DICTIONARY_KEYS.faultCodes),
      layout: 'half',
    },
    {
      id: 'faultDescription',
      label: t('warranty_claims.form.faultDescription'),
      type: 'textarea',
      rows: 4,
      layout: 'full',
    },
    {
      id: 'qtyClaimed',
      label: t('warranty_claims.form.qtyClaimed'),
      type: 'number',
      required: true,
      layout: 'half',
    },
  ], [loadCustomerOptions, loadDictionaryOptions, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'header',
      title: t('warranty_claims.form.header'),
      fields: ['claimType', 'customerId', 'orderId', 'priority', 'reasonCode', 'notes'],
    },
    {
      id: 'line',
      title: t('warranty_claims.form.lineHeader'),
      fields: ['productName', 'sku', 'serialNumber', 'faultCode', 'faultDescription', 'qtyClaimed'],
    },
  ], [t])

  const initialValues = React.useMemo<Partial<ClaimCreateFormValues>>(() => ({
    claimType: searchParams.get('claimType') ?? 'warranty',
    orderId: searchParams.get('orderId') ?? '',
    priority: 'normal',
    qtyClaimed: 1,
  }), [searchParams])

  return (
    <Page>
      <PageBody>
        <CrudForm<ClaimCreateFormValues>
          title={t('warranty_claims.create.title')}
          backHref="/backend/warranty_claims"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('warranty_claims.form.submit')}
          cancelHref="/backend/warranty_claims"
          onSubmit={async (values) => {
            const payload: Record<string, unknown> = {
              claimType: values.claimType,
              channel: 'staff',
              priority: values.priority || 'normal',
              customerId: nullableText(values.customerId),
              orderId: nullableText(values.orderId),
              reasonCode: nullableText(values.reasonCode),
              notes: nullableText(values.notes),
              lines: [
                {
                  productName: nullableText(values.productName),
                  sku: nullableText(values.sku),
                  serialNumber: nullableText(values.serialNumber),
                  faultCode: nullableText(values.faultCode),
                  faultDescription: nullableText(values.faultDescription),
                  qtyClaimed: values.qtyClaimed || 1,
                },
              ],
            }
            const { result } = await createCrud<{ id?: string | null }>('warranty_claims', payload, {
              errorMessage: t('warranty_claims.create.error'),
            })
            const id = result?.id ?? null
            flash(t('warranty_claims.create.success'), 'success')
            router.push(id ? `/backend/warranty_claims/${id}` : '/backend/warranty_claims')
          }}
        />
      </PageBody>
    </Page>
  )
}
