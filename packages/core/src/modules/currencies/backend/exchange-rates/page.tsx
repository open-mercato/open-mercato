'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type ExchangeRateRow = {
  id: string
  fromCurrencyCode: string
  toCurrencyCode: string
  rate: string
  date: string
  source: string | null
  type: string | null
  isActive: boolean
  organizationId: string
  tenantId: string
  createdAt: string
  updatedAt: string
}

type ResponsePayload = {
  items: ExchangeRateRow[]
  total: number
  page: number
  totalPages: number
}

export default function ExchangeRatesPage() {
  const t = useT()
  const [rows, setRows] = React.useState<ExchangeRateRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        if (search) params.set('search', search)
        if (filters.fromCurrencyCode) params.set('fromCurrencyCode', String(filters.fromCurrencyCode))
        if (filters.toCurrencyCode) params.set('toCurrencyCode', String(filters.toCurrencyCode))
        if (filters.source) params.set('source', String(filters.source))
        if (filters.type) params.set('type', String(filters.type))
        if (filters.isActive === 'true') params.set('isActive', 'true')
        if (filters.isActive === 'false') params.set('isActive', 'false')

        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(
          `/api/currencies/exchange-rates?${params.toString()}`,
          undefined,
          { fallback }
        )

        if (!call.ok) {
          flash(t('exchangeRates.list.error.load'), 'error')
          return
        }

        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch (error) {
        if (!cancelled) {
          flash(t('exchangeRates.list.error.load'), 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [page, search, filters, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(
    async (row: ExchangeRateRow) => {
      if (!confirm(t('exchangeRates.list.confirmDelete', { pair: `${row.fromCurrencyCode}/${row.toCurrencyCode}` }))) {
        return
      }

      try {
        const call = await apiCall(`/api/currencies/exchange-rates`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id, organizationId: row.organizationId, tenantId: row.tenantId }),
        })

        if (!call.ok) {
          flash(t('exchangeRates.flash.deleteError'), 'error')
          return
        }

        flash(t('exchangeRates.flash.deleted'), 'success')
        setReloadToken((token) => token + 1)
      } catch (error) {
        flash(t('exchangeRates.flash.deleteError'), 'error')
      }
    },
    [t]
  )

  const columns = React.useMemo<ColumnDef<ExchangeRateRow>[]>(
    () => [
      {
        accessorKey: 'currencyPair',
        header: t('exchangeRates.list.columns.currencyPair'),
        cell: ({ row }) => (
          <span className="font-mono font-medium">
            {row.original.fromCurrencyCode} → {row.original.toCurrencyCode}
          </span>
        ),
      },
      {
        accessorKey: 'rate',
        header: t('exchangeRates.list.columns.rate'),
        cell: ({ row }) => (
          <span className="font-mono">
            {parseFloat(row.original.rate).toFixed(8)}
          </span>
        ),
      },
    {
      accessorKey: 'date',
      header: t('exchangeRates.list.columns.date'),
      cell: ({ row }) => new Date(row.original.date).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }),
    },
      {
        accessorKey: 'source',
        header: t('exchangeRates.list.columns.source'),
        cell: ({ row }) => row.original.source || '—',
      },
      {
        accessorKey: 'type',
        header: t('exchangeRates.list.columns.type'),
        cell: ({ row }) => {
          const type = row.original.type
          if (!type) return '—'
          return (
            <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${
              type === 'buy' 
                ? 'bg-green-100 text-green-800' 
                : 'bg-blue-100 text-blue-800'
            }`}>
              {type === 'buy' ? t('exchangeRates.list.type.buy') : t('exchangeRates.list.type.sell')}
            </span>
          )
        },
      },
      {
        accessorKey: 'isActive',
        header: t('exchangeRates.list.columns.active'),
        enableSorting: false,
        cell: ({ getValue }) => <BooleanIcon value={Boolean(getValue())} />,
      },
      {
        accessorKey: 'createdAt',
        header: t('exchangeRates.list.columns.createdAt'),
        cell: ({ row }) => {
          const date = row.original.createdAt
          return date ? new Date(date).toLocaleString() : '—'
        },
      },
      {
        accessorKey: 'updatedAt',
        header: t('exchangeRates.list.columns.updatedAt'),
        cell: ({ row }) => {
          const date = row.original.updatedAt
          return date ? new Date(date).toLocaleString() : '—'
        },
      },
    ],
    [t]
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'fromCurrencyCode',
        label: t('exchangeRates.list.filters.fromCurrency'),
        type: 'text',
      },
      {
        id: 'toCurrencyCode',
        label: t('exchangeRates.list.filters.toCurrency'),
        type: 'text',
      },
      {
        id: 'source',
        label: t('exchangeRates.list.filters.source'),
        type: 'text',
      },
      {
        id: 'type',
        label: t('exchangeRates.list.filters.type'),
        type: 'select',
        options: [
          { label: t('exchangeRates.list.filters.all'), value: '' },
          { label: t('exchangeRates.list.type.buy'), value: 'buy' },
          { label: t('exchangeRates.list.type.sell'), value: 'sell' },
        ],
      },
      {
        id: 'isActive',
        label: t('exchangeRates.list.filters.status'),
        type: 'select',
        options: [
          { label: t('exchangeRates.list.filters.all'), value: '' },
          { label: t('exchangeRates.list.filters.active'), value: 'true' },
          { label: t('exchangeRates.list.filters.inactive'), value: 'false' },
        ],
      },
    ],
    [t]
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('exchangeRates.list.title')}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('exchangeRates.list.searchPlaceholder')}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(values) => {
            setFilters(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilters({})
            setPage(1)
          }}
          actions={
            <Button asChild>
              <Link href="/backend/exchange-rates/create">
                <Plus className="mr-2 h-4 w-4" />
                {t('exchangeRates.list.actions.create')}
              </Link>
            </Button>
          }
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  label: t('common.edit'),
                  href: `/backend/exchange-rates/${row.id}`,
                },
                {
                  label: t('common.delete'),
                  destructive: true,
                  onSelect: () => handleDelete(row),
                },
              ]}
            />
          )}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          perspective={{ tableId: 'exchange-rates.list' }}
        />
      </PageBody>
    </Page>
  )
}
