"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { type TranslateFn, useT } from '@open-mercato/shared/lib/i18n/context'
import { localizeDictionaryLabel, type DictionaryLabelKind } from '../../../../lib/dictionaryLabels'
import {
  loadOrderOptions,
  loadSalesReturnOptions,
  resolveOrderLabel,
  resolveSalesReturnLabel,
} from '../../../components/orderLookup'

type ClaimEditRecord = {
  id: string
  status: string | null
  customerId: string | null
  customerName: string | null
  orderId: string | null
  orderNumber: string | null
  reasonCode: string | null
  priority: string | null
  notes: string | null
  advanceReplacement: boolean
  replacementOrderId: string | null
  advanceShippedAt: string | null
  salesReturnId: string | null
  creditMemoId: string | null
  vendorName: string | null
  vendorRef: string | null
  resolutionSummary: string | null
  updatedAt: string | null
}

type ClaimEditFormValues = Partial<ClaimEditRecord> & Record<string, unknown>

const CLAIM_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const INTAKE_STATUSES = new Set<string>(['draft', 'submitted', 'in_review', 'info_requested'])
const FULFILLMENT_STATUSES = new Set<string>(['approved', 'awaiting_return', 'received', 'inspecting'])
const DELETABLE_STATUSES = new Set<string>(['draft', 'cancelled'])
const DICTIONARY_KEYS = {
  claimReasons: 'warranty_claims.warranty_claim_reason',
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function normalizeClaim(value: unknown): ClaimEditRecord | null {
  if (!isRecord(value)) return null
  const id = toStringOrNull(value.id)
  if (!id) return null
  return {
    id,
    status: toStringOrNull(value.status),
    customerId: toStringOrNull(value.customerId),
    customerName: toStringOrNull(value.customerName),
    orderId: toStringOrNull(value.orderId),
    orderNumber: toStringOrNull(value.orderNumber),
    reasonCode: toStringOrNull(value.reasonCode),
    priority: toStringOrNull(value.priority),
    notes: toStringOrNull(value.notes),
    advanceReplacement: value.advanceReplacement === true,
    replacementOrderId: toStringOrNull(value.replacementOrderId),
    advanceShippedAt: toStringOrNull(value.advanceShippedAt),
    salesReturnId: toStringOrNull(value.salesReturnId),
    creditMemoId: toStringOrNull(value.creditMemoId),
    vendorName: toStringOrNull(value.vendorName),
    vendorRef: toStringOrNull(value.vendorRef),
    resolutionSummary: toStringOrNull(value.resolutionSummary),
    updatedAt: toStringOrNull(value.updatedAt),
  }
}

function normalizeOption(item: unknown, t: TranslateFn): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  const label =
    toStringOrNull(item.label) ??
    toStringOrNull(item.displayName) ??
    toStringOrNull(item.display_name) ??
    toStringOrNull(item.name) ??
    t('warranty_claims.form.customerUnnamed', 'Unnamed customer')
  const email = toStringOrNull(item.primaryEmail) ?? toStringOrNull(item.primary_email)
  return { value: id, label: email ? `${label} (${email})` : label }
}

function normalizeDictionaryOption(item: unknown): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const value = toStringOrNull(item.value)
  if (!value) return null
  return { value, label: toStringOrNull(item.label) ?? value }
}

function normalizeCreditMemoOption(item: unknown, fallbackLabel: string): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  const creditMemoNumber = toStringOrNull(item.credit_memo_number) ?? toStringOrNull(item.creditMemoNumber)
  return { value: id, label: creditMemoNumber ?? fallbackLabel }
}

export async function loadCreditMemoOptions(
  query?: string,
  params?: { orderId?: string | null; fallbackLabel?: string },
): Promise<CrudFieldOption[]> {
  if (!params?.orderId) return []
  const searchParams = new URLSearchParams({ orderId: params.orderId, page: '1', pageSize: '50' })
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/sales/credit-memos?${searchParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  if (response.ok === false && response.status === 403) return []
  const fallbackLabel = params.fallbackLabel ?? '—'
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  const options = items
    .map((item) => normalizeCreditMemoOption(item, fallbackLabel))
    .filter((option): option is CrudFieldOption => option !== null)
  const needle = query?.trim().toLowerCase()
  if (!needle) return options
  return options.filter((option) => option.label.toLowerCase().includes(needle))
}

export async function resolveCreditMemoLabel(value: string, fallbackLabel: string = '—'): Promise<string> {
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/sales/credit-memos?${new URLSearchParams({ id: value, page: '1', pageSize: '1' }).toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const option = (response.result?.items ?? [])
    .map((item) => normalizeCreditMemoOption(item, fallbackLabel))
    .find((item): item is CrudFieldOption => item !== null && item.value === value)
  return option?.label ?? fallbackLabel
}

export function createCreditMemoFieldConfig(t: TranslateFn, orderId: string | null): CrudField {
  const fallbackLabel = t('warranty_claims.form.creditMemoUnavailable', 'Credit memo unavailable')
  return {
    id: 'creditMemoId',
    label: t('warranty_claims.form.creditMemoId'),
    type: 'combobox',
    loadOptions: (query?: string) => loadCreditMemoOptions(query, { orderId, fallbackLabel }),
    allowCustomValues: false,
    resolveLabel: (value: string) => resolveCreditMemoLabel(value, fallbackLabel),
    seedOptions: [],
    description: orderId
      ? undefined
      : t('warranty_claims.form.creditMemoId.noOrder', 'Link the claim to an order first to select a credit memo.'),
  }
}

function nullableText(value: unknown): string | null {
  return toStringOrNull(value)
}

export default function EditWarrantyClaimPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : ''
  const [claim, setClaim] = React.useState<ClaimEditRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  const loadDictionaryOptions = React.useCallback(async (
    dictionaryKey: string,
    kind: DictionaryLabelKind,
  ): Promise<CrudFieldOption[]> => {
    const dictionaries = await readApiResultOrThrow<{ items?: Array<{ id?: string; key?: string }> }>(
      '/api/dictionaries',
      undefined,
      {
        fallback: { items: [] },
        errorMessage: t('warranty_claims.form.error.dictionaryLoad'),
      },
    )
    const dictionary = (dictionaries.items ?? []).find((item) => item.key === dictionaryKey)
    if (!dictionary?.id) return []
    const entries = await readApiResultOrThrow<{ items?: unknown[] }>(
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
      .map((option) => ({
        ...option,
        label: localizeDictionaryLabel(t, kind, option.value, option.label),
      }))
  }, [t])

  const loadCustomerOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    const paramsForSearch = new URLSearchParams({ page: '1', pageSize: '20' })
    const trimmed = query?.trim()
    if (trimmed) paramsForSearch.set('search', trimmed)
    const [people, companies] = await Promise.all([
      apiCall<{ items?: unknown[] }>(`/api/customers/people?${paramsForSearch.toString()}`, undefined, { fallback: { items: [] } }),
      apiCall<{ items?: unknown[] }>(`/api/customers/companies?${paramsForSearch.toString()}`, undefined, { fallback: { items: [] } }),
    ])
    const items = [
      ...(Array.isArray(people.result?.items) ? people.result.items : []),
      ...(Array.isArray(companies.result?.items) ? companies.result.items : []),
    ]
    return items.map((item) => normalizeOption(item, t)).filter((option): option is CrudFieldOption => option !== null)
  }, [t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const payload = await readApiResultOrThrow<{ items?: unknown[] }>(
          `/api/warranty_claims?ids=${encodeURIComponent(id)}&page=1&pageSize=1`,
          undefined,
          { fallback: { items: [] }, errorMessage: t('warranty_claims.edit.error.load') },
        )
        if (cancelled) return
        const item = (payload.items ?? []).map(normalizeClaim).find((entry): entry is ClaimEditRecord => entry !== null) ?? null
        if (!item) {
          setClaim(null)
          setNotFound(true)
          return
        }
        setClaim(item)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('warranty_claims.edit.error.load'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (id) void load()
    return () => {
      cancelled = true
    }
  }, [id, t])

  const status = claim?.status ?? ''
  const editableMode = INTAKE_STATUSES.has(status)
    ? 'intake'
    : FULFILLMENT_STATUSES.has(status)
      ? 'fulfillment'
      : 'locked'

  const claimOrderId = claim?.orderId ?? null
  const loadSalesReturnOptionsForClaim = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    return loadSalesReturnOptions(query, {
      orderId: claimOrderId,
      fallbackLabel: t('warranty_claims.form.returnUnavailable', 'Return unavailable'),
    })
  }, [claimOrderId, t])

  const fields = React.useMemo<CrudField[]>(() => {
    if (editableMode === 'intake') {
      return [
        {
          id: 'customerId',
          label: t('warranty_claims.form.customerId'),
          type: 'combobox',
          layout: 'half',
          loadOptions: loadCustomerOptions,
          allowCustomValues: false,
          placeholder: t('warranty_claims.form.customerId.placeholder'),
          seedOptions: claim?.customerId && claim.customerName
            ? [{ value: claim.customerId, label: claim.customerName }]
            : [],
        },
        { id: 'customerName', label: t('warranty_claims.form.customerName'), type: 'text', layout: 'third' },
        {
          id: 'orderId',
          label: t('warranty_claims.form.orderId'),
          type: 'combobox',
          layout: 'half',
          loadOptions: (query?: string) => loadOrderOptions(query, {
            fallbackLabel: t('warranty_claims.form.orderUnavailable', 'Order unavailable'),
          }),
          allowCustomValues: false,
          placeholder: t('warranty_claims.form.orderId.placeholder'),
          resolveLabel: (value: string) => resolveOrderLabel(value, t('warranty_claims.form.orderUnavailable', 'Order unavailable')),
          seedOptions: claim?.orderId && claim.orderNumber
            ? [{ value: claim.orderId, label: claim.orderNumber }]
            : [],
        },
        {
          id: 'reasonCode',
          label: t('warranty_claims.form.reasonCode'),
          type: 'select',
          layout: 'third',
          loadOptions: () => loadDictionaryOptions(DICTIONARY_KEYS.claimReasons, 'reason'),
        },
        {
          id: 'priority',
          label: t('warranty_claims.form.priority'),
          type: 'select',
          layout: 'third',
          options: CLAIM_PRIORITIES.map((priority) => ({
            value: priority,
            label: t(`warranty_claims.priority.${priority}`),
          })),
        },
        { id: 'notes', label: t('warranty_claims.form.notes'), type: 'textarea', rows: 5, layout: 'full' },
      ]
    }
    if (editableMode === 'fulfillment') {
      return [
        { id: 'advanceReplacement', label: t('warranty_claims.form.advanceReplacement'), type: 'checkbox', layout: 'third' },
        {
          id: 'replacementOrderId',
          label: t('warranty_claims.form.replacementOrderId'),
          type: 'combobox',
          layout: 'half',
          loadOptions: (query?: string) => loadOrderOptions(query, {
            fallbackLabel: t('warranty_claims.form.orderUnavailable', 'Order unavailable'),
          }),
          allowCustomValues: false,
          resolveLabel: (value: string) => resolveOrderLabel(value, t('warranty_claims.form.orderUnavailable', 'Order unavailable')),
          seedOptions: [],
        },
        { id: 'advanceShippedAt', label: t('warranty_claims.form.advanceShippedAt'), type: 'datetime-local', layout: 'third' },
        {
          id: 'salesReturnId',
          label: t('warranty_claims.form.salesReturnId'),
          type: 'combobox',
          layout: 'half',
          loadOptions: loadSalesReturnOptionsForClaim,
          allowCustomValues: false,
          resolveLabel: (value: string) => resolveSalesReturnLabel(value, t('warranty_claims.form.returnUnavailable', 'Return unavailable')),
          seedOptions: [],
          description: claimOrderId
            ? undefined
            : t('warranty_claims.form.salesReturnId.noOrder', 'Link the claim to an order first to select a return.'),
        },
        createCreditMemoFieldConfig(t, claimOrderId),
        { id: 'vendorName', label: t('warranty_claims.form.vendorName'), type: 'text', layout: 'half' },
        { id: 'vendorRef', label: t('warranty_claims.form.vendorRef'), type: 'text', layout: 'half' },
        { id: 'resolutionSummary', label: t('warranty_claims.form.resolutionSummary'), type: 'textarea', rows: 5, layout: 'full' },
      ]
    }
    return []
  }, [claim?.customerId, claim?.customerName, claim?.orderNumber, claimOrderId, editableMode, loadCustomerOptions, loadDictionaryOptions, loadSalesReturnOptionsForClaim, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'claim',
      title: editableMode === 'fulfillment'
        ? t('warranty_claims.edit.fulfillmentFields')
        : t('warranty_claims.edit.intakeFields'),
      fields: fields.map((field) => field.id),
    },
  ], [editableMode, fields, t])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('warranty_claims.edit.loading')} />
        </PageBody>
      </Page>
    )
  }

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('warranty_claims.errors.notFound')}
            backHref="/backend/warranty_claims"
            backLabel={t('warranty_claims.detail.actions.backToList')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !claim) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('warranty_claims.edit.error.load')} />
        </PageBody>
      </Page>
    )
  }

  if (editableMode === 'locked') {
    return (
      <Page>
        <PageBody>
          <EmptyState
            title={t('warranty_claims.edit.locked.title')}
            description={t('warranty_claims.edit.locked.description')}
            variant="subtle"
            actions={(
              <Button type="button" variant="outline" onClick={() => router.push(`/backend/warranty_claims/${claim.id}`)}>
                {t('warranty_claims.detail.actions.backToDetail')}
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<ClaimEditFormValues>
          title={t('warranty_claims.edit.title')}
          backHref={`/backend/warranty_claims/${claim.id}`}
          fields={fields}
          groups={groups}
          initialValues={{ ...claim }}
          submitLabel={t('warranty_claims.form.submit')}
          cancelHref={`/backend/warranty_claims/${claim.id}`}
          onSubmit={async (values) => {
            const payload: Record<string, unknown> = { id: claim.id }
            if (editableMode === 'intake') {
              payload.customerId = nullableText(values.customerId)
              payload.customerName = nullableText(values.customerName)
              payload.orderId = nullableText(values.orderId)
              payload.reasonCode = nullableText(values.reasonCode)
              payload.priority = nullableText(values.priority)
              payload.notes = nullableText(values.notes)
            } else {
              payload.advanceReplacement = values.advanceReplacement === true
              payload.replacementOrderId = nullableText(values.replacementOrderId)
              payload.advanceShippedAt = nullableText(values.advanceShippedAt)
              payload.salesReturnId = nullableText(values.salesReturnId)
              payload.creditMemoId = nullableText(values.creditMemoId)
              payload.vendorName = nullableText(values.vendorName)
              payload.vendorRef = nullableText(values.vendorRef)
              payload.resolutionSummary = nullableText(values.resolutionSummary)
            }
            await updateCrud('warranty_claims', payload, {
              errorMessage: t('warranty_claims.edit.error.save'),
            })
            flash(t('warranty_claims.edit.success'), 'success')
            router.push(`/backend/warranty_claims/${claim.id}`)
          }}
          onDelete={DELETABLE_STATUSES.has(status)
            ? async () => {
              await deleteCrud('warranty_claims', claim.id, {
                errorMessage: t('warranty_claims.edit.error.delete'),
              })
              flash(t('warranty_claims.edit.deleted'), 'success')
              router.push('/backend/warranty_claims')
            }
            : undefined}
        />
      </PageBody>
    </Page>
  )
}
