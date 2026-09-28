"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customer_groups').child({ component: 'PersonGroupsExplainTerms' })

type GroupSummary = { id: string; code: string; name: string }

type ExplainTermsField = {
  value: string | number | boolean | null
  sourceGroupId: string | null
  path: GroupSummary[]
}

// Mirrors the `GET /api/customer_groups/customer-groups/explain-terms` response shape (see the
// route's own `ExplainTermsResponse`/`ExplainTermsField` types) — kept as a local
// client-side copy since API route modules are server-only and not importable here.
type ExplainTermsResponse = {
  groups: GroupSummary[]
  fields: {
    priceKindId: ExplainTermsField
    paymentTermsDays: ExplainTermsField
    allowPurchaseOnAccount: ExplainTermsField
    approvalRequiredAbove: ExplainTermsField
    minOrderValue: ExplainTermsField
  }
}

const TERMS_FIELD_ORDER = [
  'priceKindId',
  'paymentTermsDays',
  'allowPurchaseOnAccount',
  'approvalRequiredAbove',
  'minOrderValue',
] as const

type TermsFieldKey = (typeof TERMS_FIELD_ORDER)[number]

const FIELD_LABEL_KEYS: Record<TermsFieldKey, [string, string]> = {
  priceKindId: ['customer_groups.groups.personTab.explainTerms.field.priceKindId', 'Price kind'],
  paymentTermsDays: ['customer_groups.groups.personTab.explainTerms.field.paymentTermsDays', 'Payment terms'],
  allowPurchaseOnAccount: [
    'customer_groups.groups.personTab.explainTerms.field.allowPurchaseOnAccount',
    'Allow purchase on account',
  ],
  approvalRequiredAbove: [
    'customer_groups.groups.personTab.explainTerms.field.approvalRequiredAbove',
    'Approval required above',
  ],
  minOrderValue: ['customer_groups.groups.personTab.explainTerms.field.minOrderValue', 'Minimum order value'],
}

function pickString(item: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.length) return value
  }
  return ''
}

// Mirrors `resolvePriceKindLabel` in `../../components/CustomerGroupTermsPriceKindField.tsx`
// — that file's helper is an unexported implementation detail of its combobox, and
// this panel is read-only display (no combobox), so the same `/api/catalog/price-kinds?id=`
// lookup is re-implemented locally rather than imported.
async function resolvePriceKindLabel(id: string): Promise<string> {
  try {
    const params = new URLSearchParams({ id, pageSize: '1' })
    const payload = await readApiResultOrThrow<{ items?: Record<string, unknown>[] }>(
      `/api/catalog/price-kinds?${params.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    const item = items[0]
    if (!item) return id
    const title = pickString(item, 'title') || id
    const code = pickString(item, 'code')
    return code ? `${title} (${code})` : title
  } catch (err) {
    logger.error('customer_groups.explainTerms.priceKind.resolve', { err })
    return id
  }
}

function formatFieldValue(
  field: TermsFieldKey,
  entry: ExplainTermsField,
  priceKindLabels: Record<string, string>,
  t: TranslateFn,
): string {
  const notSet = t('customer_groups.groups.personTab.explainTerms.notSet', 'Not set')
  if (field === 'priceKindId') {
    if (typeof entry.value !== 'string' || !entry.value) return notSet
    return priceKindLabels[entry.value] ?? entry.value
  }
  if (field === 'paymentTermsDays') {
    if (typeof entry.value !== 'number') return notSet
    return t('customer_groups.groups.personTab.explainTerms.value.days', '{count} days', { count: entry.value })
  }
  if (field === 'allowPurchaseOnAccount') {
    return entry.value === true
      ? t('customer_groups.groups.personTab.explainTerms.value.yes', 'Yes')
      : t('customer_groups.groups.personTab.explainTerms.value.no', 'No')
  }
  // approvalRequiredAbove / minOrderValue
  if (typeof entry.value !== 'number') return notSet
  return String(entry.value)
}

function formatSourceLabel(entry: ExplainTermsField, t: TranslateFn): string {
  if (entry.sourceGroupId == null) {
    return t('customer_groups.groups.personTab.explainTerms.tenantDefault', 'Tenant default')
  }
  const path = entry.path.map((group) => `${group.name} (${group.code})`).join(' → ')
  return t('customer_groups.groups.personTab.explainTerms.viaPath', 'via {path}', { path })
}

function ExplainTermsRow({
  field,
  entry,
  priceKindLabels,
}: {
  field: TermsFieldKey
  entry: ExplainTermsField
  priceKindLabels: Record<string, string>
}) {
  const t = useT()
  const [labelKey, labelFallback] = FIELD_LABEL_KEYS[field]
  const fieldLabel = t(labelKey, labelFallback)
  const valueLabel = formatFieldValue(field, entry, priceKindLabels, t)
  const sourceLabel = formatSourceLabel(entry, t)

  return (
    <li className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{fieldLabel}</span>
        <span className="text-sm text-foreground">{valueLabel}</span>
      </div>
      <div className="text-xs text-muted-foreground">{sourceLabel}</div>
    </li>
  )
}

export function PersonGroupsExplainTerms({
  customerId,
  refreshKey = 0,
}: {
  customerId: string
  refreshKey?: number
}) {
  const t = useT()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [data, setData] = React.useState<ExplainTermsResponse | null>(null)
  const [priceKindLabels, setPriceKindLabels] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiCall<ExplainTermsResponse>(`/api/customer_groups/customer-groups/explain-terms?customerId=${encodeURIComponent(customerId)}`)
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.result) {
          setData(res.result)
        } else if (res.status === 403) {
          setData(null)
        } else {
          throw new Error('explain-terms')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            t('customer_groups.groups.personTab.explainTerms.errors.load', 'Failed to load resolved terms.'),
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [customerId, refreshKey, t])

  const priceKindId = data?.fields.priceKindId.value
  React.useEffect(() => {
    let cancelled = false
    if (typeof priceKindId !== 'string' || !priceKindId) return
    resolvePriceKindLabel(priceKindId).then((label) => {
      if (!cancelled) setPriceKindLabels((prev) => (prev[priceKindId] ? prev : { ...prev, [priceKindId]: label }))
    })
    return () => {
      cancelled = true
    }
  }, [priceKindId])

  if (loading) {
    return <LoadingMessage label={t('customer_groups.groups.personTab.explainTerms.loading', 'Loading resolved terms…')} />
  }
  if (error) return <ErrorMessage label={error} />
  if (!data) return null

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <SectionHeader title={t('customer_groups.groups.personTab.explainTerms.title', 'Explain terms')} />
      <ul
        className="space-y-2"
        aria-label={t('customer_groups.groups.personTab.explainTerms.listLabel', 'Resolved commercial terms')}
      >
        {TERMS_FIELD_ORDER.map((field) => (
          <ExplainTermsRow key={field} field={field} entry={data.fields[field]} priceKindLabels={priceKindLabels} />
        ))}
      </ul>
    </div>
  )
}

export default PersonGroupsExplainTerms
