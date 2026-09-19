"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { extensionPoints } from '@open-mercato/core/modules/catalog/extension-points'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useBatchLabels } from './useBatchLabels'
import { normalizePriceRecord, type NormalizedPriceRecord } from './normalizePriceRecord'

type PriceRow = NormalizedPriceRecord

type PricesResponse = {
  items: PriceRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  totalIsCapped?: boolean
}

const PAGE_SIZE = 50

const KIND_TAG_VARIANT: Record<string, 'brand' | 'warning' | 'info' | 'neutral'> = {
  custom: 'brand',
  promotion: 'warning',
  tier: 'info',
  regular: 'neutral',
}

function formatAmount(row: PriceRow): string {
  const amount = row.unitPriceNet ?? row.unitPriceGross
  if (amount == null) return '—'
  return row.currencyCode ? `${amount} ${row.currencyCode}` : amount
}

function formatQuantityRange(row: PriceRow, t: TranslateFn): string {
  if (row.maxQuantity != null) {
    return `${row.minQuantity}–${row.maxQuantity}`
  }
  return t('catalog.prices.list.quantity.min', '{{min}}+', { min: row.minQuantity })
}

export default function PricesDataTable({ productId }: { productId?: string } = {}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [canManage, setCanManage] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const call = await apiCall<{ granted?: string[]; ok?: boolean }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['catalog.pricing.manage'] }),
        })
        if (!cancelled) {
          const granted = Array.isArray(call.result?.granted) ? call.result.granted : []
          setCanManage(call.result?.ok === true || granted.includes('catalog.pricing.manage'))
        }
      } catch {
        if (!cancelled) setCanManage(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    if (productId) params.set('productId', productId)
    if (search) params.set('search', search)
    return params.toString()
  }, [page, productId, search])

  const { data, isLoading } = useQuery<PricesResponse>({
    queryKey: ['catalog-prices', queryParams, scopeVersion],
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{
        items?: Array<Record<string, unknown>>
        total?: number
        page?: number
        pageSize?: number
        totalPages?: number
        totalIsCapped?: boolean
      }>(
        `/api/catalog/prices?${queryParams}`,
        undefined,
        { errorMessage: t('catalog.prices.list.error.load', 'Failed to load price rules') },
      )
      const rawItems = Array.isArray(payload.items) ? payload.items : []
      return {
        items: rawItems.map(normalizePriceRecord),
        total: typeof payload.total === 'number' ? payload.total : 0,
        page: typeof payload.page === 'number' ? payload.page : 1,
        pageSize: typeof payload.pageSize === 'number' ? payload.pageSize : PAGE_SIZE,
        totalPages: typeof payload.totalPages === 'number' ? payload.totalPages : 1,
        totalIsCapped: payload.totalIsCapped === true,
      }
    },
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 0
  const totalIsCapped = data?.totalIsCapped === true

  const productIds = React.useMemo(() => rows.map((row) => row.variantId ?? row.productId).filter((id): id is string => !!id), [rows])
  const mapProduct = React.useCallback((item: Record<string, unknown>) => {
    const id = typeof item.id === 'string' ? item.id : ''
    if (!id) return null
    const label = typeof item.title === 'string' ? item.title : (typeof item.name === 'string' ? item.name : id)
    return { id, label }
  }, [])
  const productLabels = useBatchLabels('/api/catalog/products', rows.filter((r) => !r.variantId).map((r) => r.productId ?? ''), mapProduct)
  const variantLabels = useBatchLabels('/api/catalog/variants', rows.filter((r) => r.variantId).map((r) => r.variantId ?? ''), mapProduct)

  const customerIds = React.useMemo(() => rows.map((row) => row.customerId).filter((id): id is string => !!id), [rows])
  const mapCustomer = React.useCallback((item: Record<string, unknown>) => {
    const id = typeof item.id === 'string' ? item.id : ''
    if (!id) return null
    const label = typeof item.displayName === 'string' ? item.displayName : (typeof item.display_name === 'string' ? item.display_name : id)
    return { id, label }
  }, [])
  const customerLabels = useBatchLabels('/api/customers/people', customerIds, mapCustomer)

  const channelIds = React.useMemo(() => rows.map((row) => row.channelId).filter((id): id is string => !!id), [rows])
  const mapChannel = React.useCallback((item: Record<string, unknown>) => {
    const id = typeof item.id === 'string' ? item.id : ''
    if (!id) return null
    const label = typeof item.name === 'string' ? item.name : id
    return { id, label }
  }, [])
  const channelLabels = useBatchLabels('/api/sales/channels', channelIds, mapChannel)

  const handleDelete = React.useCallback(async (row: PriceRow) => {
    const confirmed = await confirm({
      title: t('catalog.prices.list.confirmDelete', 'Delete this price rule?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await apiCallOrThrow(
        `/api/catalog/prices?id=${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
        { errorMessage: t('catalog.prices.list.error.delete', 'Failed to delete price rule') },
      )
      await queryClient.invalidateQueries({ queryKey: ['catalog-prices'] })
      flash(t('catalog.prices.flash.deleted', 'Price rule deleted'), 'success')
    } catch (err: unknown) {
      const fallback = t('catalog.prices.list.error.delete', 'Failed to delete price rule')
      const message = err instanceof Error ? err.message : fallback
      flash(message, 'error')
    }
  }, [confirm, queryClient, t])

  const columns = React.useMemo<ColumnDef<PriceRow>[]>(() => [
    {
      id: 'product',
      header: t('catalog.prices.list.columns.product', 'Product'),
      meta: { priority: 1 },
      cell: ({ row }) => {
        const price = row.original
        const label = price.variantId
          ? (variantLabels[price.variantId] ?? price.variantId)
          : (price.productId ? (productLabels[price.productId] ?? price.productId) : '—')
        return <span className="text-sm font-medium text-foreground">{label}</span>
      },
    },
    {
      id: 'kind',
      header: t('catalog.prices.list.columns.kind', 'Kind'),
      meta: { priority: 2 },
      cell: ({ row }) => {
        const kind = row.original.kind || 'regular'
        return <Tag variant={KIND_TAG_VARIANT[kind] ?? 'neutral'}>{kind}</Tag>
      },
    },
    {
      id: 'amount',
      header: t('catalog.prices.list.columns.amount', 'Amount'),
      meta: { priority: 1 },
      cell: ({ row }) => <span className="text-sm">{formatAmount(row.original)}</span>,
    },
    {
      id: 'scope',
      header: t('catalog.prices.list.columns.scope', 'Scope'),
      meta: { priority: 3 },
      cell: ({ row }) => {
        const price = row.original
        const chips: React.ReactNode[] = []
        if (price.customerId) {
          chips.push(
            <Tag key="customer" variant="info" dot>
              {customerLabels[price.customerId] ?? t('catalog.prices.list.scope.customer', 'Customer')}
            </Tag>,
          )
        }
        if (price.customerGroupId) {
          chips.push(
            <Tag key="customerGroup" variant="info" dot>
              {t('catalog.prices.list.scope.customerGroup', 'Customer group')}
            </Tag>,
          )
        }
        if (price.channelId) {
          chips.push(
            <Tag key="channel" variant="neutral" dot>
              {channelLabels[price.channelId] ?? t('catalog.prices.list.scope.channel', 'Channel')}
            </Tag>,
          )
        }
        if (!chips.length) return <span className="text-xs text-muted-foreground">—</span>
        return <div className="flex flex-wrap gap-1">{chips}</div>
      },
    },
    {
      id: 'quantity',
      header: t('catalog.prices.list.columns.quantity', 'Quantity'),
      meta: { priority: 4 },
      cell: ({ row }) => <span className="text-sm">{formatQuantityRange(row.original, t)}</span>,
    },
    {
      id: 'validity',
      header: t('catalog.prices.list.columns.validity', 'Validity'),
      meta: { priority: 5 },
      cell: ({ row }) => {
        const price = row.original
        const isExpired = Boolean(price.endsAt && new Date(price.endsAt) < new Date())
        if (!price.startsAt && !price.endsAt) {
          return <span className="text-sm text-muted-foreground">{t('catalog.prices.list.validity.always', 'Always')}</span>
        }
        const from = price.startsAt ? new Date(price.startsAt).toLocaleDateString() : null
        const until = price.endsAt ? new Date(price.endsAt).toLocaleDateString() : null
        const label = from && until
          ? t('catalog.prices.list.validity.range', '{{from}} – {{until}}', { from, until })
          : from
            ? t('catalog.prices.list.validity.from', 'From {{date}}', { date: from })
            : t('catalog.prices.list.validity.until', 'Until {{date}}', { date: until ?? '' })
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm">{label}</span>
            {isExpired ? <Tag variant="error" dot>{t('catalog.prices.list.badge.expired', 'Expired')}</Tag> : null}
          </div>
        )
      },
    },
  ], [t, variantLabels, productLabels, customerLabels, channelLabels])

  return (
    <>
      <DataTable
        title={t('catalog.prices.list.title', 'Price rules')}
        titleHeadingLevel={1}
        actions={canManage ? (
          <Button asChild>
            <Link href="/backend/catalog/prices/create">
              {t('catalog.prices.list.actions.create', 'Create')}
            </Link>
          </Button>
        ) : undefined}
        columns={columns}
        data={rows}
        emptyState={(
          <ListEmptyState
            entityName={t('catalog.prices.list.title', 'Price rules')}
            description={t('catalog.prices.list.empty', 'No price rules yet — add one to price this product beyond its base price.')}
            createHref={canManage ? '/backend/catalog/prices/create' : undefined}
            createLabel={canManage ? t('catalog.prices.list.actions.create', 'Create') : undefined}
          />
        )}
        searchValue={search}
        searchPlaceholder={t('catalog.prices.list.searchPlaceholder', 'Search price rules')}
        onSearchChange={(value) => { setSearch(value); setPage(1) }}
        sortable={false}
        perspective={{ tableId: extensionPoints.hosts.pricesTable.tableId }}
        rowActions={(row) => (
          canManage ? (
            <RowActions
              items={[
                { id: 'edit', label: t('catalog.prices.list.actions.edit', 'Edit'), href: `/backend/catalog/prices/${row.id}/edit` },
                { id: 'delete', label: t('catalog.prices.list.actions.delete', 'Delete'), destructive: true, onSelect: () => handleDelete(row) },
              ]}
            />
          ) : null
        )}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages,
          totalIsCapped,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
      />
      {ConfirmDialogElement}
    </>
  )
}
