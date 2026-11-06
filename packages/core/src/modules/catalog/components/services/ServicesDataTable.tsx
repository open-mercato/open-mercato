"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'

type ServiceRow = {
  id: string
  title: string
  description?: string | null
  scope?: string | null
  categoryId?: string | null
  categoryName?: string | null
  defaultPriceAmount?: string | number | null
  defaultPriceCurrencyCode?: string | null
  workRequirements?: unknown[]
  isActive: boolean
  updated_at?: string | null
}

type ServiceResponseItem = ServiceRow & {
  category?: { name?: string | null } | null
  default_price_amount?: string | number | null
  default_price_currency_code?: string | null
  is_active?: boolean | null
}

type ServicesResponse = {
  items?: ServiceResponseItem[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

const PAGE_SIZE = 50

function normalizeServiceRow(row: ServiceResponseItem): ServiceRow {
  return {
    ...row,
    categoryName: row.categoryName ?? row.category?.name ?? null,
    defaultPriceAmount: row.defaultPriceAmount ?? row.default_price_amount ?? null,
    defaultPriceCurrencyCode: row.defaultPriceCurrencyCode ?? row.default_price_currency_code ?? null,
    isActive: row.isActive ?? row.is_active ?? true,
  }
}

const PRICE_FORMAT_LOCALES: Record<string, string> = {
  en: 'en-US',
  pl: 'pl-PL',
  de: 'de-DE',
  es: 'es-ES',
}

function resolvePriceFormatLocale(locale?: string | null): string {
  if (!locale) return PRICE_FORMAT_LOCALES.en
  return PRICE_FORMAT_LOCALES[locale] ?? locale
}

function formatPrice(row: ServiceRow, locale?: string | null): string {
  if (row.defaultPriceAmount === null || row.defaultPriceAmount === undefined || row.defaultPriceAmount === '') return '—'
  return formatServiceDefaultPrice(row.defaultPriceAmount, row.defaultPriceCurrencyCode, '—', locale)
}

export function formatServiceDefaultPrice(
  amount: string | number | null | undefined,
  currency: string | null | undefined,
  fallback = '—',
  locale?: string | null,
): string {
  if (amount === null || amount === undefined || amount === '') return fallback
  const parsed = typeof amount === 'string' ? Number(amount) : amount
  const formatLocale = resolvePriceFormatLocale(locale)
  if (!Number.isFinite(parsed)) {
    const code = currency?.trim()
    return `${amount}${code ? ` ${code}` : ''}`.trim()
  }
  const code = currency?.trim().toUpperCase()
  if (code) {
    try {
      return new Intl.NumberFormat(formatLocale, {
        style: 'currency',
        currency: code,
        currencyDisplay: 'code',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
        .format(parsed)
        .replace(/[\u00a0\u202f]/g, ' ')
    } catch {
      return `${parsed.toLocaleString(formatLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`
    }
  }
  return parsed.toLocaleString(formatLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ServicesDataTable() {
  const t = useT()
  const locale = useLocale()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)
  const [status, setStatus] = React.useState<'all' | 'active' | 'inactive'>('all')
  const [search, setSearch] = React.useState('')
  const [canManage, setCanManage] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const call = await apiCall<{ granted?: string[]; ok?: boolean }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['catalog.services.manage'] }),
        })
        if (!cancelled) {
          const granted = Array.isArray(call.result?.granted) ? call.result.granted : []
          setCanManage(call.result?.ok === true || granted.includes('catalog.services.manage'))
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
    if (status === 'active') params.set('isActive', 'true')
    if (status === 'inactive') params.set('isActive', 'false')
    if (search) params.set('search', search)
    return params.toString()
  }, [page, search, status])

  const { data, isLoading } = useQuery<ServicesResponse>({
    queryKey: ['catalog-services', queryParams, scopeVersion],
    queryFn: async () => {
      const payload = await readApiResultOrThrow<ServicesResponse>(
        `/api/catalog/services?${queryParams}`,
        undefined,
        { errorMessage: t('catalog.services.list.error.load', 'Failed to load services') },
      )
      return {
        items: Array.isArray(payload.items) ? payload.items.map(normalizeServiceRow) : [],
        total: typeof payload.total === 'number' ? payload.total : 0,
        page: typeof payload.page === 'number' ? payload.page : 1,
        pageSize: typeof payload.pageSize === 'number' ? payload.pageSize : PAGE_SIZE,
        totalPages: typeof payload.totalPages === 'number' ? payload.totalPages : 1,
      }
    },
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 0

  const columns = React.useMemo<ColumnDef<ServiceRow>[]>(() => [
    {
      accessorKey: 'title',
      header: t('catalog.services.list.columns.service', 'Service'),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <div className="space-y-1">
          <div className="text-sm font-medium">{row.original.title}</div>
          {row.original.scope ? <div className="line-clamp-1 text-xs text-muted-foreground">{row.original.scope}</div> : null}
        </div>
      ),
    },
    {
      accessorKey: 'categoryName',
      header: t('catalog.services.list.columns.category', 'Category'),
      meta: { priority: 4 },
      cell: ({ getValue }) => getValue<string>() || '—',
    },
    {
      id: 'defaultPrice',
      header: t('catalog.services.list.columns.defaultPrice', 'Default price'),
      meta: { priority: 2 },
      cell: ({ row }) => formatPrice(row.original, locale),
    },
    {
      id: 'requirements',
      header: t('catalog.services.list.columns.requirements', 'Requirements'),
      meta: { priority: 5 },
      cell: ({ row }) => Array.isArray(row.original.workRequirements) ? row.original.workRequirements.length : 0,
    },
    {
      accessorKey: 'isActive',
      header: t('catalog.services.list.columns.active', 'Active'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ getValue }) => <BooleanIcon value={Boolean(getValue())} />,
    },
  ], [t])

  const handleDelete = React.useCallback(async (service: ServiceRow) => {
    const confirmed = await confirm({
      title: t('catalog.services.list.confirmDelete', 'Archive service "{{name}}"?', { name: service.title }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const headers = buildOptimisticLockHeader(typeof service.updated_at === 'string' ? service.updated_at : null)
      await withScopedApiRequestHeaders(headers, () =>
        deleteCrud('catalog/services', service.id, {
          errorMessage: t('catalog.services.list.error.delete', 'Failed to delete service'),
        }),
      )
      await queryClient.invalidateQueries({ queryKey: ['catalog-services'] })
      flash(t('catalog.services.flash.deleted', 'Service archived'), 'success')
    } catch (err: unknown) {
      const fallback = t('catalog.services.list.error.delete', 'Failed to delete service')
      flash(err instanceof Error ? err.message : fallback, 'error')
    }
  }, [confirm, queryClient, t])

  return (
    <>
      <DataTable
        title={t('catalog.services.list.title', 'Services')}
        actions={canManage ? (
          <Button asChild>
            <Link href="/backend/catalog/services/create">
              {t('catalog.services.list.actions.create', 'Create')}
            </Link>
          </Button>
        ) : undefined}
        columns={columns}
        data={rows}
        emptyState={(
          <ListEmptyState
            entityName={t('catalog.services.list.title', 'Services')}
            createHref={canManage ? '/backend/catalog/services/create' : undefined}
            createLabel={canManage ? t('catalog.services.list.actions.create', 'Create') : undefined}
          />
        )}
        searchValue={search}
        searchPlaceholder={t('catalog.services.list.searchPlaceholder', 'Search services')}
        onSearchChange={(value) => { setSearch(value); setPage(1) }}
        filters={[
          {
            id: 'status',
            label: t('catalog.services.list.filters.status', 'Status'),
            type: 'select',
            options: [
              { value: 'all', label: t('catalog.services.list.filters.all', 'All') },
              { value: 'active', label: t('catalog.services.list.filters.active', 'Active') },
              { value: 'inactive', label: t('catalog.services.list.filters.inactive', 'Inactive') },
            ],
          },
        ]}
        filterValues={status === 'all' ? {} : { status }}
        onFiltersApply={(values: FilterValues) => {
          setStatus((values.status as 'all' | 'active' | 'inactive' | undefined) ?? 'all')
          setPage(1)
        }}
        onFiltersClear={() => {
          setStatus('all')
          setPage(1)
        }}
        sortable={false}
        perspective={{ tableId: 'catalog.services.list' }}
        rowActions={(row) => (
          canManage ? (
            <RowActions
              items={[
                { id: 'edit', label: t('catalog.services.list.actions.edit', 'Edit'), href: `/backend/catalog/services/${row.id}/edit` },
                { id: 'delete', label: t('catalog.services.list.actions.delete', 'Delete'), destructive: true, onSelect: () => handleDelete(row) },
              ]}
            />
          ) : null
        )}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
      />
      {ConfirmDialogElement}
    </>
  )
}
