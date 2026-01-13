'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { Plus, Star } from 'lucide-react'
import { useT } from '@/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type CurrencyRow = {
  id: string
  code: string
  name: string
  symbol: string | null
  decimalPlaces: number
  isBase: boolean
  isActive: boolean
  organizationId: string
  tenantId: string
}

type ResponsePayload = {
  items: CurrencyRow[]
  total: number
  page: number
  totalPages: number
}

export default function CurrenciesPage() {
  const t = useT()
  const [rows, setRows] = React.useState<CurrencyRow[]>([])
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
        if (filters.isBase === true) params.set('isBase', 'true')
        if (filters.isActive === 'true') params.set('isActive', 'true')
        if (filters.isActive === 'false') params.set('isActive', 'false')

        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(
          `/api/currencies/currencies?${params.toString()}`,
          undefined,
          { fallback }
        )

        if (!call.ok) {
          flash(t('currencies.list.error.load'), 'error')
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
          flash(t('currencies.list.error.load'), 'error')
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

  const handleSetBase = React.useCallback(
    async (row: CurrencyRow) => {
      try {
        const call = await apiCall('/api/currencies', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id, isBase: true }),
        })

        if (!call.ok) {
          flash(t('currencies.flash.baseSetError'), 'error')
          return
        }

        flash(t('currencies.flash.baseSet'), 'success')
        setReloadToken((token) => token + 1)
      } catch (error) {
        flash(t('currencies.flash.baseSetError'), 'error')
      }
    },
    [t]
  )

  const handleDelete = React.useCallback(
    async (row: CurrencyRow) => {
      if (!confirm(t('currencies.list.confirmDelete', { code: row.code }))) {
        return
      }

      try {
        const call = await apiCall(`/api/currencies/currencies`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id, organizationId: row.organizationId, tenantId: row.tenantId }),
        })

        if (!call.ok) {
          flash(t('currencies.flash.deleteError'), 'error')
          return
        }

        flash(t('currencies.flash.deleted'), 'success')
        setReloadToken((token) => token + 1)
      } catch (error) {
        flash(t('currencies.flash.deleteError'), 'error')
      }
    },
    [t]
  )

  const columns = React.useMemo<ColumnDef<CurrencyRow>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('currencies.list.columns.code'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium">{row.original.code}</span>
            {row.original.isBase && (
              <Badge variant="default" className="gap-1">
                <Star className="h-3 w-3" />
                {t('currencies.list.base')}
              </Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'name',
        header: t('currencies.list.columns.name'),
      },
      {
        accessorKey: 'symbol',
        header: t('currencies.list.columns.symbol'),
        cell: ({ row }) => row.original.symbol || '—',
      },
      {
        accessorKey: 'decimalPlaces',
        header: t('currencies.list.columns.decimalPlaces'),
      },
      {
        accessorKey: 'isActive',
        header: t('currencies.list.columns.active'),
        enableSorting: false,
        cell: ({ getValue }) => <BooleanIcon value={Boolean(getValue())} />,
      },
    ],
    [t]
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'isBase',
        label: t('currencies.list.filters.baseOnly'),
        type: 'checkbox',
      },
      {
        id: 'isActive',
        label: t('currencies.list.filters.status'),
        type: 'select',
        options: [
          { label: t('currencies.list.filters.all'), value: '' },
          { label: t('currencies.list.filters.active'), value: 'true' },
          { label: t('currencies.list.filters.inactive'), value: 'false' },
        ],
      },
    ],
    [t]
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('currencies.list.title')}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('currencies.list.searchPlaceholder')}
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
              <Link href="/backend/currencies/create">
                <Plus className="mr-2 h-4 w-4" />
                {t('currencies.list.actions.create')}
              </Link>
            </Button>
          }
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  label: t('common.edit'),
                  href: `/backend/currencies/${row.id}`,
                },
                ...(!row.isBase
                  ? [
                      {
                        label: t('currencies.list.actions.setBase'),
                        onSelect: () => handleSetBase(row),
                      },
                    ]
                  : []),
                ...(!row.isBase
                  ? [
                      {
                        label: t('common.delete'),
                        destructive: true,
                        onSelect: () => handleDelete(row),
                      },
                    ]
                  : []),
              ]}
            />
          )}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          perspective={{ tableId: 'currencies.list' }}
        />
      </PageBody>
    </Page>
  )
}
