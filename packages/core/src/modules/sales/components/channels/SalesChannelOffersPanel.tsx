"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@/lib/i18n/context'

type OfferRow = {
  id: string
  title: string
  description: string | null
  productId: string | null
  productTitle: string | null
  productSku: string | null
  productMediaUrl: string | null
  prices: Array<{
    id?: string
    priceKindId?: string | null
    priceKindCode?: string | null
    priceKindTitle?: string | null
    currencyCode?: string | null
    unitPriceNet?: string | null
    unitPriceGross?: string | null
    displayMode?: string | null
  }>
  isActive: boolean
  updatedAt: string | null
}

type OffersResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 25

export function SalesChannelOffersPanel({ channelId, channelName }: { channelId: string; channelName?: string }) {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<OfferRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setLoading] = React.useState(true)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [reloadToken, setReloadToken] = React.useState(0)

  const columns = React.useMemo<ColumnDef<OfferRow>[]>(() => [
    {
      accessorKey: 'title',
      header: t('sales.channels.offers.table.offer', 'Offer'),
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          {row.original.productMediaUrl ? (
            <img
              src={row.original.productMediaUrl}
              alt={row.original.productTitle ?? row.original.title}
              className="h-12 w-12 rounded border object-cover"
            />
          ) : (
            <div className="h-12 w-12 rounded border bg-muted" />
          )}
          <div className="flex flex-col">
            <span className="font-medium">{row.original.title}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.productTitle ?? t('sales.channels.offers.table.emptyProduct', 'Unlinked product')}
            </span>
          </div>
        </div>
      ),
      meta: { sticky: true },
    },
    {
      accessorKey: 'prices',
      header: t('sales.channels.offers.table.prices', 'Price overrides'),
      cell: ({ row }) => renderPriceSummary(row.original, t),
    },
    {
      accessorKey: 'isActive',
      header: t('sales.channels.offers.table.active', 'Active'),
      cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
    },
    {
      accessorKey: 'updatedAt',
      header: t('sales.channels.offers.table.updated', 'Updated'),
      cell: ({ row }) =>
        row.original.updatedAt
          ? <span className="text-xs text-muted-foreground">{new Date(row.original.updatedAt).toLocaleDateString()}</span>
          : <span className="text-xs text-muted-foreground">—</span>,
    },
  ], [t])

  const loadOffers = React.useCallback(async () => {
    if (!channelId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        channelId,
      })
      if (search.trim().length) {
        params.set('search', search.trim())
      }
      const sort = sorting[0]
      if (sort?.id) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      const payload = await readApiResultOrThrow<OffersResponse>(
        `/api/catalog/offers?${params.toString()}`,
        undefined,
        { errorMessage: t('sales.channels.offers.errors.load', 'Failed to load offers.') },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapOfferRow))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (err) {
      console.error('sales.channels.offers', err)
      flash(t('sales.channels.offers.errors.load', 'Failed to load offers.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [channelId, page, search, sorting, t])

  React.useEffect(() => {
    void loadOffers()
  }, [loadOffers, reloadToken])

  const handleDelete = React.useCallback(async (row: OfferRow) => {
    try {
      await deleteCrud('catalog/offers', row.id, {
        errorMessage: t('sales.channels.offers.errors.delete', 'Failed to delete offer.'),
      })
      flash(t('sales.channels.offers.messages.deleted', 'Offer deleted.'), 'success')
      setReloadToken((token) => token + 1)
    } catch (err) {
      console.error('sales.channels.offers.delete', err)
    }
  }, [t])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {t('sales.channels.offers.heading', 'Offers for {{name}}', { name: channelName || t('sales.channels.nav.title', 'Sales channels') })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('sales.channels.offers.subtitle', 'Override product presentation and pricing per channel.')}
          </p>
        </div>
        <Button asChild>
          <Link href={`/backend/sales/channels/${channelId}/offers/create`}>
            {t('sales.channels.offers.actions.create', 'Add offer')}
          </Link>
        </Button>
      </div>
      <DataTable<OfferRow>
        columns={columns}
        data={rows}
        isLoading={isLoading}
        sorting={sorting}
        onSortingChange={setSorting}
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder={t('sales.channels.offers.table.search', 'Search offers…')}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages,
          onPageChange: setPage,
        }}
        refreshButton={{
          label: t('sales.channels.offers.table.refresh', 'Refresh'),
          onRefresh: () => setReloadToken((token) => token + 1),
          isRefreshing: isLoading,
        }}
        rowActions={(row) => (
          <RowActions
            items={[
              {
                id: 'edit',
                label: t('sales.channels.offers.actions.edit', 'Edit'),
                href: `/backend/sales/channels/${channelId}/offers/${row.id}/edit`,
              },
              {
                id: 'delete',
                label: t('sales.channels.offers.actions.delete', 'Delete'),
                onSelect: () => handleDelete(row),
                destructive: true,
              },
            ]}
          />
        )}
        onRowClick={(row) => router.push(`/backend/sales/channels/${channelId}/offers/${row.id}/edit`)}
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t('sales.channels.offers.table.empty', 'No offers for this channel yet.')}
          </div>
        }
      />
    </div>
  )
}

function mapOfferRow(item: Record<string, unknown>): OfferRow {
  const product = item.product && typeof item.product === 'object'
    ? item.product as Record<string, unknown>
    : null
  const prices = Array.isArray(item.prices) ? item.prices as Array<Record<string, unknown>> : []
  return {
    id: typeof item.id === 'string' ? item.id : '',
    title: typeof item.title === 'string' && item.title.length ? item.title : 'Untitled offer',
    description: typeof item.description === 'string' ? item.description : null,
    productId: typeof item.productId === 'string' ? item.productId : typeof item.product_id === 'string' ? item.product_id : null,
    productTitle: typeof product?.title === 'string' ? product.title : null,
    productSku: typeof product?.sku === 'string' ? product.sku : null,
    productMediaUrl: typeof product?.defaultMediaUrl === 'string'
      ? product.defaultMediaUrl
      : typeof product?.default_media_url === 'string'
        ? product.default_media_url
        : null,
    prices: prices.map((row) => ({
      id: typeof row.id === 'string' ? row.id : undefined,
      priceKindId: typeof row.priceKindId === 'string'
        ? row.priceKindId
        : typeof row.price_kind_id === 'string'
          ? row.price_kind_id
          : null,
      priceKindCode: typeof row.priceKindCode === 'string'
        ? row.priceKindCode
        : typeof row.price_kind_code === 'string'
          ? row.price_kind_code
          : null,
      priceKindTitle: typeof row.priceKindTitle === 'string'
        ? row.priceKindTitle
        : typeof row.price_kind_title === 'string'
          ? row.price_kind_title
          : null,
      currencyCode: typeof row.currencyCode === 'string'
        ? row.currencyCode
        : typeof row.currency_code === 'string'
          ? row.currency_code
          : null,
      unitPriceNet: typeof row.unitPriceNet === 'string'
        ? row.unitPriceNet
        : typeof row.unit_price_net === 'string'
          ? row.unit_price_net
          : null,
      unitPriceGross: typeof row.unitPriceGross === 'string'
        ? row.unitPriceGross
        : typeof row.unit_price_gross === 'string'
          ? row.unit_price_gross
          : null,
      displayMode: typeof row.displayMode === 'string'
        ? row.displayMode
        : typeof row.display_mode === 'string'
          ? row.display_mode
          : null,
    })),
    isActive: item.isActive === true || item.is_active === true,
    updatedAt: typeof item.updatedAt === 'string'
      ? item.updatedAt
      : typeof item.updated_at === 'string'
        ? item.updated_at
        : null,
  }
}

function renderPriceSummary(row: OfferRow, t: (key: string, fallback: string, vars?: Record<string, unknown>) => string) {
  if (!row.prices.length) {
    return <span className="text-xs text-muted-foreground">{t('sales.channels.offers.table.noOverrides', 'No overrides')}</span>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {row.prices.map((price) => {
        const label = price.priceKindCode || price.priceKindTitle || t('sales.channels.offers.table.price', 'Price')
        const numeric = price.displayMode === 'including-tax'
          ? price.unitPriceGross ?? price.unitPriceNet
          : price.unitPriceNet ?? price.unitPriceGross
        return (
          <div key={`${price.id}-${label}`} className="rounded border px-2 py-1 text-xs">
            <div className="font-medium">{label}</div>
            <div className="text-muted-foreground">
              {price.currencyCode ?? ''} {numeric ?? '—'}
            </div>
          </div>
        )
      })}
    </div>
  )
}
