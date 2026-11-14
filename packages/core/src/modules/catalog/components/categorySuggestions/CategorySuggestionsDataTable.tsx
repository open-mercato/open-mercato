"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { BulkAction } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'

type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'auto_applied' | 'superseded'

type SuggestionItem = {
  id: string
  productId: string
  outcome: string
  categoryId: string | null
  categoryLive: boolean
  confidence: number | null
  status: string
  trigger: string
  model: string | null
  createdAt: string
  updatedAt: string
}

type SuggestionRow = SuggestionItem & {
  productTitle: string | null
  productSku: string | null
  categoryLabel: string | null
}

type SuggestionListResponse = {
  items?: SuggestionItem[]
  total?: number
  totalIsCapped?: boolean
}

type ProductLookupResponse = {
  items?: Array<{ id: string; title?: string | null; sku?: string | null }>
}

type CategoryLookupResponse = {
  items?: Array<{ id: string; pathLabel?: string | null; name?: string | null }>
}

type SuggestionTable = {
  rows: SuggestionRow[]
  total: number
  totalIsCapped: boolean
}

type RowOutcome = { id: string; ok: boolean; skipped: boolean }

const PAGE_SIZE = 50
const STATUS_VALUES: SuggestionStatus[] = ['pending', 'accepted', 'rejected', 'auto_applied', 'superseded']
const CONFIDENCE_VALUES = ['0.5', '0.7', '0.9']
const QUERY_KEY = 'catalog-category-suggestions'

function statusVariant(status: string): StatusBadgeVariant {
  switch (status) {
    case 'pending':
      return 'info'
    case 'accepted':
    case 'auto_applied':
      return 'success'
    default:
      return 'neutral'
  }
}

function isActionable(row: SuggestionRow): boolean {
  return row.status === 'pending'
}

function isAcceptable(row: SuggestionRow): boolean {
  return isActionable(row) && row.outcome === 'suggested' && !!row.categoryId && row.categoryLive
}

function joinIds(ids: string[]): string {
  return ids.join(',')
}

async function fetchSuggestionTable(
  queryString: string,
  unknownCategoryLabel: string,
  errorMessage: string,
): Promise<SuggestionTable> {
  const list = await readApiResultOrThrow<SuggestionListResponse>(
    `/api/catalog/category-suggestions?${queryString}`,
    undefined,
    { errorMessage },
  )
  const items = Array.isArray(list.items) ? list.items : []
  const productIds = Array.from(new Set(items.map((item) => item.productId)))
  const categoryIds = Array.from(
    new Set(items.map((item) => item.categoryId).filter((id): id is string => !!id)),
  )
  const [products, categories] = await Promise.all([
    productIds.length
      ? readApiResultOrThrow<ProductLookupResponse>(
          `/api/catalog/products?ids=${encodeURIComponent(joinIds(productIds))}&pageSize=100`,
          undefined,
          { errorMessage, fallback: { items: [] } },
        )
      : Promise.resolve<ProductLookupResponse>({ items: [] }),
    categoryIds.length
      ? readApiResultOrThrow<CategoryLookupResponse>(
          `/api/catalog/categories?view=manage&ids=${encodeURIComponent(joinIds(categoryIds))}&pageSize=100`,
          undefined,
          { errorMessage, fallback: { items: [] } },
        )
      : Promise.resolve<CategoryLookupResponse>({ items: [] }),
  ])
  const productById = new Map((products.items ?? []).map((product) => [product.id, product]))
  const categoryById = new Map((categories.items ?? []).map((category) => [category.id, category]))
  const rows = items.map<SuggestionRow>((item) => {
    const product = productById.get(item.productId)
    const category = item.categoryId ? categoryById.get(item.categoryId) : undefined
    return {
      ...item,
      productTitle: product?.title ?? null,
      productSku: product?.sku ?? null,
      categoryLabel: item.categoryId
        ? (category?.pathLabel ?? category?.name ?? unknownCategoryLabel)
        : null,
    }
  })
  return {
    rows,
    total: typeof list.total === 'number' ? list.total : rows.length,
    totalIsCapped: list.totalIsCapped === true,
  }
}

export default function CategorySuggestionsDataTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)
  const [status, setStatus] = React.useState<SuggestionStatus | 'all'>('pending')
  const [minConfidence, setMinConfidence] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'catalog.category-suggestions.review',
  })

  const queryString = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    if (status !== 'all') params.set('status', status)
    if (minConfidence) params.set('minConfidence', minConfidence)
    return params.toString()
  }, [page, status, minConfidence])

  const unknownCategoryLabel = t('catalog.categorySuggestions.list.unknownCategory', 'Unknown category')
  const loadError = t('catalog.categorySuggestions.list.error.load', 'Failed to load category suggestions.')

  const { data, isLoading, isError, refetch } = useQuery<SuggestionTable>({
    queryKey: [QUERY_KEY, queryString, scopeVersion],
    queryFn: () => fetchSuggestionTable(queryString, unknownCategoryLabel, loadError),
    placeholderData: (previous) => previous,
  })

  const rows = React.useMemo(() => data?.rows ?? [], [data])
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [QUERY_KEY] })
  }, [queryClient])

  const acceptRow = React.useCallback(async (row: SuggestionRow): Promise<void> => {
    await runMutation({
      operation: () => withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        async () => {
          const call = await apiCall(`/api/catalog/category-suggestions/${row.id}/accept`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ makeMain: false }),
          })
          if (!call.ok) {
            await raiseCrudError(
              call.response,
              t('catalog.categorySuggestions.errors.accept', 'Failed to accept the category suggestion.'),
            )
          }
          return call.result
        },
      ),
      context: { resourceKind: 'catalog.category_suggestion', resourceId: row.id, retryLastMutation },
    })
  }, [retryLastMutation, runMutation, t])

  const rejectRow = React.useCallback(async (row: SuggestionRow): Promise<void> => {
    await runMutation({
      operation: () => withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        async () => {
          const call = await apiCall(`/api/catalog/category-suggestions/${row.id}/reject`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
          if (!call.ok) {
            await raiseCrudError(
              call.response,
              t('catalog.categorySuggestions.errors.reject', 'Failed to reject the category suggestion.'),
            )
          }
          return call.result
        },
      ),
      context: { resourceKind: 'catalog.category_suggestion', resourceId: row.id, retryLastMutation },
    })
  }, [retryLastMutation, runMutation, t])

  const handleSingle = React.useCallback(async (row: SuggestionRow, kind: 'accept' | 'reject') => {
    try {
      if (kind === 'accept') await acceptRow(row)
      else await rejectRow(row)
      flash(
        kind === 'accept'
          ? t('catalog.categorySuggestions.flash.accepted', 'Category accepted.')
          : t('catalog.categorySuggestions.flash.rejected', 'Suggestion rejected.'),
        'success',
      )
    } catch (err) {
      const fallback = kind === 'accept'
        ? t('catalog.categorySuggestions.errors.accept', 'Failed to accept the category suggestion.')
        : t('catalog.categorySuggestions.errors.reject', 'Failed to reject the category suggestion.')
      flash(err instanceof Error && err.message ? err.message : fallback, 'error')
    } finally {
      await refresh()
    }
  }, [acceptRow, refresh, rejectRow, t])

  const runBulk = React.useCallback(async (
    selected: SuggestionRow[],
    kind: 'accept' | 'reject',
  ): Promise<false> => {
    const outcomes: RowOutcome[] = []
    for (const row of selected) {
      const eligible = kind === 'accept' ? isAcceptable(row) : isActionable(row)
      if (!eligible) {
        outcomes.push({ id: row.id, ok: false, skipped: true })
        continue
      }
      try {
        if (kind === 'accept') await acceptRow(row)
        else await rejectRow(row)
        outcomes.push({ id: row.id, ok: true, skipped: false })
      } catch {
        outcomes.push({ id: row.id, ok: false, skipped: false })
      }
    }
    const succeeded = outcomes.filter((outcome) => outcome.ok).length
    const skipped = outcomes.filter((outcome) => outcome.skipped).length
    const failed = outcomes.length - succeeded - skipped
    const summaryKey = kind === 'accept'
      ? 'catalog.categorySuggestions.bulk.acceptSummary'
      : 'catalog.categorySuggestions.bulk.rejectSummary'
    const summaryFallback = kind === 'accept'
      ? 'Accepted {succeeded} of {total} suggestions. Failed: {failed}. Skipped: {skipped}.'
      : 'Rejected {succeeded} of {total} suggestions. Failed: {failed}. Skipped: {skipped}.'
    flash(
      t(summaryKey, summaryFallback, { succeeded, total: outcomes.length, failed, skipped }),
      failed > 0 ? 'warning' : skipped > 0 ? 'info' : 'success',
    )
    await refresh()
    return false
  }, [acceptRow, refresh, rejectRow, t])

  const bulkActions = React.useMemo<BulkAction<SuggestionRow>[]>(() => [
    {
      id: 'catalog.category-suggestions.accept-selected',
      label: t('catalog.categorySuggestions.bulk.accept', 'Accept selected'),
      onExecute: (selected) => runBulk(selected, 'accept'),
    },
    {
      id: 'catalog.category-suggestions.reject-selected',
      label: t('catalog.categorySuggestions.bulk.reject', 'Reject selected'),
      destructive: true,
      onExecute: (selected) => runBulk(selected, 'reject'),
    },
  ], [runBulk, t])

  const columns = React.useMemo<ColumnDef<SuggestionRow>[]>(() => [
    {
      accessorKey: 'productTitle',
      header: t('catalog.categorySuggestions.list.columns.product', 'Product'),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <div className="flex max-w-xs flex-col">
          <Link
            href={`/backend/catalog/products/${row.original.productId}`}
            title={row.original.productTitle ?? row.original.productId}
            className="truncate text-sm font-medium text-foreground hover:underline"
          >
            {row.original.productTitle ?? row.original.productId}
          </Link>
          {row.original.productSku ? (
            <span className="truncate text-xs text-muted-foreground" title={row.original.productSku}>
              {row.original.productSku}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'categoryLabel',
      header: t('catalog.categorySuggestions.list.columns.category', 'Suggested category'),
      meta: { priority: 2 },
      cell: ({ row }) => {
        if (row.original.outcome === 'no_match' || !row.original.categoryId) {
          return (
            <span className="text-xs text-muted-foreground">
              {t('catalog.categorySuggestions.list.noMatch', 'No matching category')}
            </span>
          )
        }
        return (
          <div className="flex max-w-xs flex-col">
            <span className="truncate text-sm text-foreground" title={row.original.categoryLabel ?? undefined}>
              {row.original.categoryLabel}
            </span>
            {!row.original.categoryLive ? (
              <span className="text-xs text-status-error-text">
                {t('catalog.categorySuggestions.list.categoryGone', 'This category no longer exists.')}
              </span>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'confidence',
      header: t('catalog.categorySuggestions.list.columns.confidence', 'Confidence'),
      meta: { priority: 3 },
      cell: ({ row }) => {
        const confidence = row.original.confidence
        if (confidence === null) return <span className="text-xs text-muted-foreground">—</span>
        const percent = Math.round(confidence * 100)
        return (
          <StatusBadge variant={percent >= 70 ? 'success' : 'warning'}>
            {t('catalog.categorySuggestions.list.confidenceValue', '{percent}%', { percent })}
          </StatusBadge>
        )
      },
    },
    {
      accessorKey: 'status',
      header: t('catalog.categorySuggestions.list.columns.status', 'Status'),
      meta: { priority: 2 },
      cell: ({ row }) => (
        <StatusBadge variant={statusVariant(row.original.status)} dot>
          {t(`catalog.categorySuggestions.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'trigger',
      header: t('catalog.categorySuggestions.list.columns.trigger', 'Trigger'),
      meta: { priority: 4 },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {t(`catalog.categorySuggestions.trigger.${row.original.trigger}`, row.original.trigger)}
        </span>
      ),
    },
    {
      accessorKey: 'model',
      header: t('catalog.categorySuggestions.list.columns.model', 'Model'),
      meta: { priority: 5 },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.model ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('catalog.categorySuggestions.list.columns.created', 'Created'),
      meta: { priority: 5 },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatDateTime(row.original.createdAt) ?? '—'}</span>
      ),
    },
  ], [t])

  if (isLoading && !data) {
    return <LoadingMessage label={t('catalog.categorySuggestions.list.loading', 'Loading category suggestions...')} />
  }

  if (isError) {
    return (
      <ErrorMessage
        label={loadError}
        action={(
          <Button type="button" variant="outline" size="sm" onClick={() => { void refetch() }}>
            {t('catalog.categorySuggestions.list.retry', 'Retry')}
          </Button>
        )}
      />
    )
  }

  return (
    <DataTable<SuggestionRow>
      title={t('catalog.categorySuggestions.page.title', 'AI category suggestions')}
      titleHeadingLevel={1}
      columns={columns}
      data={rows}
      bulkActions={bulkActions}
      emptyState={(
        <ListEmptyState
          entityName={t('catalog.categorySuggestions.page.title', 'AI category suggestions')}
          description={t(
            'catalog.categorySuggestions.list.empty',
            'No category suggestions match these filters. Run AI categorization from the products list to create some.',
          )}
        />
      )}
      filters={[
        {
          id: 'status',
          label: t('catalog.categorySuggestions.list.filters.status', 'Status'),
          type: 'select',
          options: [
            { value: 'all', label: t('catalog.categorySuggestions.list.filters.all', 'All') },
            ...STATUS_VALUES.map((value) => ({
              value,
              label: t(`catalog.categorySuggestions.status.${value}`, value),
            })),
          ],
        },
        {
          id: 'minConfidence',
          label: t('catalog.categorySuggestions.list.filters.minConfidence', 'Minimum confidence'),
          type: 'select',
          options: CONFIDENCE_VALUES.map((value) => ({
            value,
            label: t('catalog.categorySuggestions.list.confidenceAtLeast', '{percent}% or more', {
              percent: Math.round(Number(value) * 100),
            }),
          })),
        },
      ]}
      filterValues={{
        ...(status === 'pending' ? {} : { status }),
        ...(minConfidence ? { minConfidence } : {}),
      }}
      onFiltersApply={(values: FilterValues) => {
        const nextStatus = typeof values.status === 'string' ? values.status : 'pending'
        setStatus(nextStatus as SuggestionStatus | 'all')
        setMinConfidence(typeof values.minConfidence === 'string' ? values.minConfidence : null)
        setPage(1)
      }}
      onFiltersClear={() => {
        setStatus('pending')
        setMinConfidence(null)
        setPage(1)
      }}
      sortable={false}
      rowActions={(row) => (
        <RowActions
          items={[
            ...(isAcceptable(row)
              ? [{
                  id: 'accept',
                  label: t('catalog.categorySuggestions.actions.accept', 'Accept'),
                  onSelect: () => { void handleSingle(row, 'accept') },
                }]
              : []),
            ...(isActionable(row)
              ? [{
                  id: 'reject',
                  label: t('catalog.categorySuggestions.actions.reject', 'Reject'),
                  destructive: true,
                  onSelect: () => { void handleSingle(row, 'reject') },
                }]
              : []),
            {
              id: 'open',
              label: t('catalog.categorySuggestions.actions.openProduct', 'Open product'),
              href: `/backend/catalog/products/${row.productId}`,
            },
          ]}
        />
      )}
      pagination={{
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages,
        totalIsCapped: data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={isLoading}
    />
  )
}
