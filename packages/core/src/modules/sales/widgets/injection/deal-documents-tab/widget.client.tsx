"use client"

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink, FileText, Receipt } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { cn } from '@open-mercato/shared/lib/utils'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { formatMoney } from '../../../components/documents/lineItemUtils'

type DealDocumentsContext = {
  resourceKind?: string
  resourceId?: string
  dealId?: string | null
}

type DocumentListItem = {
  id: string | null
  orderNumber?: string | null
  quoteNumber?: string | null
  status: string | null
  currencyCode: string | null
  grandTotalGrossAmount: number | null
  updatedAt: string | null
}

type DocumentsResponse = {
  items?: DocumentListItem[]
  total?: number
}

type GroupKey = 'quotes' | 'orders'

const GROUPS: Array<{ key: GroupKey; path: string; numberField: 'quoteNumber' | 'orderNumber'; hrefBase: string }> = [
  { key: 'quotes', path: '/api/sales/quotes', numberField: 'quoteNumber', hrefBase: '/backend/sales/quotes' },
  { key: 'orders', path: '/api/sales/orders', numberField: 'orderNumber', hrefBase: '/backend/sales/orders' },
]

function resolveDealId(context: unknown): string | null {
  if (!context || typeof context !== 'object') return null
  const candidate = context as DealDocumentsContext
  if (candidate.resourceKind && candidate.resourceKind !== 'customers.deal') return null
  const id = candidate.dealId ?? candidate.resourceId
  return typeof id === 'string' && id.trim().length ? id : null
}

function titleize(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function DocumentRow({
  document,
  numberField,
  hrefBase,
}: {
  document: DocumentListItem
  numberField: 'quoteNumber' | 'orderNumber'
  hrefBase: string
}) {
  const t = useT()
  const locale = useLocale()
  const number = document[numberField] ?? null
  const href = document.id ? `${hrefBase}/${document.id}` : hrefBase
  const updatedAt = formatDateTime(document.updatedAt)
  return (
    <li className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            href={href}
            className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            <span className="truncate">
              {number ?? t('sales.widgets.dealDocuments.unnumbered', 'Unnumbered document')}
            </span>
            <ExternalLink className="size-4 shrink-0" aria-hidden />
          </Link>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {document.grandTotalGrossAmount === null
                ? '—'
                : formatMoney(document.grandTotalGrossAmount, document.currencyCode, locale)}
            </span>
            {updatedAt ? (
              <>
                <span aria-hidden>—</span>
                <span>{updatedAt}</span>
              </>
            ) : null}
          </div>
        </div>
        <StatusBadge variant="neutral" dot>
          {document.status
            ? t(`sales.documents.status.${document.status}`, titleize(document.status))
            : t('sales.widgets.dealDocuments.unknownStatus', 'Unknown')}
        </StatusBadge>
      </div>
    </li>
  )
}

function DocumentGroup({
  group,
  documents,
  total,
}: {
  group: (typeof GROUPS)[number]
  documents: DocumentListItem[]
  total: number
}) {
  const t = useT()
  const Icon = group.key === 'quotes' ? FileText : Receipt
  return (
    <section className="space-y-2" aria-label={t(`sales.widgets.dealDocuments.${group.key}.label`, titleize(group.key))}>
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="gap-1.5">
          <Icon className="size-4" aria-hidden />
          {t(`sales.widgets.dealDocuments.${group.key}.count`, '{count} documents', { count: total })}
        </Badge>
        <Link
          href={group.hrefBase}
          className="text-xs font-medium text-primary hover:underline"
        >
          {t('sales.widgets.dealDocuments.viewAll', 'View all')}
        </Link>
      </div>
      {documents.length ? (
        <ul className={cn('space-y-2')}>
          {documents.map((document, index) => (
            <DocumentRow
              key={document.id ?? `${group.key}-${index}`}
              document={document}
              numberField={group.numberField}
              hrefBase={group.hrefBase}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t(`sales.widgets.dealDocuments.${group.key}.empty`, 'No documents linked to this deal yet.')}
        </p>
      )}
    </section>
  )
}

export function DealDocumentsTabWidget({
  context,
}: InjectionWidgetComponentProps<unknown, unknown>) {
  const t = useT()
  const [state, setState] = React.useState<Record<GroupKey, DocumentListItem[]>>({ quotes: [], orders: [] })
  const [totals, setTotals] = React.useState<Record<GroupKey, number>>({ quotes: 0, orders: 0 })
  const [denied, setDenied] = React.useState<Record<GroupKey, boolean>>({ quotes: false, orders: false })
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const dealId = resolveDealId(context)
  const requestKey = dealId ? `${dealId}` : null

  React.useEffect(() => {
    if (!requestKey) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const query = new URLSearchParams({
      dealId: requestKey,
      page: '1',
      pageSize: '20',
      sortField: 'updatedAt',
      sortDir: 'desc',
    }).toString()
    Promise.all(
      GROUPS.map(async (group) => {
        const response = await apiCall<DocumentsResponse>(`${group.path}?${query}`)
        if (response.ok && response.result) {
          const items = Array.isArray(response.result.items) ? response.result.items : []
          return { group: group.key, items, total: typeof response.result.total === 'number' ? response.result.total : items.length }
        }
        if (response.status === 403) {
          return { group: group.key, items: [], total: 0, denied: true }
        }
        return { group: group.key, items: [], total: 0, failed: true }
      }),
    )
      .then((results) => {
        if (cancelled) return
        const nextState: Record<GroupKey, DocumentListItem[]> = { quotes: [], orders: [] }
        const nextTotals: Record<GroupKey, number> = { quotes: 0, orders: 0 }
        const nextDenied: Record<GroupKey, boolean> = { quotes: false, orders: false }
        let failed = false
        for (const result of results) {
          nextState[result.group] = result.items
          nextTotals[result.group] = result.total
          if ('denied' in result) nextDenied[result.group] = true
          if ('failed' in result) failed = true
        }
        setState(nextState)
        setTotals(nextTotals)
        setDenied(nextDenied)
        if (failed) setError(t('sales.widgets.dealDocuments.error', 'Failed to load sales documents.'))
      })
      .catch(() => {
        if (!cancelled) setError(t('sales.widgets.dealDocuments.error', 'Failed to load sales documents.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [requestKey, t])

  if (!dealId) return null

  const visibleGroups = GROUPS.filter((group) => !denied[group.key])
  if (!visibleGroups.length) return null

  const hasDocuments = visibleGroups.some((group) => state[group.key].length > 0)

  if (loading) {
    return <LoadingMessage label={t('sales.widgets.dealDocuments.loading', 'Loading sales documents...')} />
  }

  if (error && !hasDocuments) {
    return <ErrorMessage label={error} />
  }

  if (!hasDocuments) {
    return (
      <EmptyState
        size="sm"
        variant="subtle"
        icon={<FileText className="h-5 w-5" aria-hidden />}
        title={t('sales.widgets.dealDocuments.empty.title', 'No sales documents for this deal')}
        description={t(
          'sales.widgets.dealDocuments.empty.description',
          'Create a quote or order and link it to this deal to track its revenue.',
        )}
        className="border border-dashed border-border"
      />
    )
  }

  return (
    <div className="space-y-5">
      {visibleGroups.map((group) => (
        <DocumentGroup
          key={group.key}
          group={group}
          documents={state[group.key]}
          total={totals[group.key]}
        />
      ))}
    </div>
  )
}

export default DealDocumentsTabWidget
