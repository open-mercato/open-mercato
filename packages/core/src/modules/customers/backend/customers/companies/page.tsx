"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { buildCrudExportUrl } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import {
  DictionaryValue,
  renderDictionaryColor,
  renderDictionaryIcon,
  type CustomerDictionaryKind,
  type CustomerDictionaryMap,
} from '../../../lib/dictionaries'
import {
  useCustomFieldDefs,
  filterCustomFieldDefs,
} from '@open-mercato/ui/backend/utils/customFieldDefs'
import { useQueryClient } from '@tanstack/react-query'
import { ensureCustomerDictionary } from '../../../components/detail/hooks/useCustomerDictionary'

type CompanyRow = {
  id: string
  name: string
  description?: string | null
  email?: string | null
  phone?: string | null
  status?: string | null
  lifecycleStage?: string | null
  nextInteractionAt?: string | null
  nextInteractionName?: string | null
  nextInteractionIcon?: string | null
  nextInteractionColor?: string | null
  organizationId?: string | null
  source?: string | null
} & Record<string, unknown>

type CompaniesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  totalPages?: number
}

type DictionaryKindKey = CustomerDictionaryKind
type DictionaryMap = CustomerDictionaryMap

function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString()
}

function mapApiItem(item: Record<string, unknown>): CompanyRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const name = typeof item.display_name === 'string' ? item.display_name : ''
  const description = typeof item.description === 'string' ? item.description : null
  const email = typeof item.primary_email === 'string' ? item.primary_email : null
  const phone = typeof item.primary_phone === 'string' ? item.primary_phone : null
  const status = typeof item.status === 'string' ? item.status : null
  const lifecycleStage = typeof item.lifecycle_stage === 'string' ? item.lifecycle_stage : null
  const nextInteractionAt = typeof item.next_interaction_at === 'string' ? item.next_interaction_at : null
  const nextInteractionName = typeof item.next_interaction_name === 'string' ? item.next_interaction_name : null
  const nextInteractionIcon = typeof item.next_interaction_icon === 'string' ? item.next_interaction_icon : null
  const nextInteractionColor = typeof item.next_interaction_color === 'string' ? item.next_interaction_color : null
  const organizationId = typeof item.organization_id === 'string' ? item.organization_id : null
  const source = typeof item.source === 'string' ? item.source : null
  const customFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key.startsWith('cf_')) {
      customFields[key] = value
    }
  }
  return {
    id,
    name,
    description,
    email,
    phone,
    status,
    lifecycleStage,
    nextInteractionAt,
    nextInteractionName,
    nextInteractionIcon,
    nextInteractionColor,
    organizationId,
    source,
    ...customFields,
  }
}

export default function CustomersCompaniesPage() {
  const [rows, setRows] = React.useState<CompanyRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [dictionaryMaps, setDictionaryMaps] = React.useState<Record<DictionaryKindKey, DictionaryMap>>({
    statuses: {},
    sources: {},
    'lifecycle-stages': {},
    'address-types': {},
    'job-titles': {},
  })
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()
  const t = useT()
  const router = useRouter()
  const fetchDictionaryEntries = React.useCallback(async (kind: DictionaryKindKey) => {
    try {
      const data = await ensureCustomerDictionary(queryClient, kind, scopeVersion)
      setDictionaryMaps((prev) => ({
        ...prev,
        [kind]: data.map,
      }))
      return data.entries
    } catch {
      return []
    }
  }, [queryClient, scopeVersion])
  const loadDictionaryOptions = React.useCallback(async (kind: 'statuses' | 'sources' | 'lifecycle-stages') => {
    const entries = await fetchDictionaryEntries(kind)
    return entries.map((entry) => ({ value: entry.value, label: entry.label }))
  }, [fetchDictionaryEntries])

  React.useEffect(() => {
    let cancelled = false
    async function loadAll() {
      if (cancelled) return
      setDictionaryMaps({ statuses: {}, sources: {}, 'lifecycle-stages': {}, 'address-types': {}, 'job-titles': {} })
      await Promise.all([
        fetchDictionaryEntries('statuses'),
        fetchDictionaryEntries('sources'),
        fetchDictionaryEntries('lifecycle-stages'),
      ])
    }
    loadAll().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [fetchDictionaryEntries, scopeVersion, reloadToken])

  const { data: customFieldDefs = [] } = useCustomFieldDefs(
    [E.customers.customer_entity, E.customers.customer_company_profile],
    { keyExtras: [scopeVersion, reloadToken] },
  )

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('customers.companies.list.filters.status'),
      type: 'select',
      loadOptions: () => loadDictionaryOptions('statuses'),
    },
    {
      id: 'source',
      label: t('customers.companies.list.filters.source'),
      type: 'select',
      loadOptions: () => loadDictionaryOptions('sources'),
    },
    {
      id: 'lifecycleStage',
      label: t('customers.companies.list.filters.lifecycleStage'),
      type: 'select',
      loadOptions: () => loadDictionaryOptions('lifecycle-stages'),
    },
    {
      id: 'createdAt',
      label: t('customers.companies.list.filters.createdAt'),
      type: 'dateRange',
    },
    {
      id: 'emailContains',
      label: t('customers.companies.list.filters.emailContains'),
      type: 'text',
      placeholder: t('customers.companies.list.filters.emailContainsPlaceholder'),
    },
    {
      id: 'hasEmail',
      label: t('customers.companies.list.filters.hasEmail'),
      type: 'checkbox',
    },
    {
      id: 'hasPhone',
      label: t('customers.companies.list.filters.hasPhone'),
      type: 'checkbox',
    },
    {
      id: 'hasNextInteraction',
      label: t('customers.companies.list.filters.hasNextInteraction'),
      type: 'checkbox',
    },
  ], [loadDictionaryOptions, t])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (search.trim()) params.set('search', search.trim())
    const status = filterValues.status
    if (typeof status === 'string' && status.trim()) params.set('status', status)
    const source = filterValues.source
    if (typeof source === 'string' && source.trim()) params.set('source', source)
    const lifecycleStage = filterValues.lifecycleStage
    if (typeof lifecycleStage === 'string' && lifecycleStage.trim()) params.set('lifecycleStage', lifecycleStage)
    const createdAt = filterValues.createdAt
    if (createdAt && typeof createdAt === 'object') {
      if (createdAt.from) params.set('createdFrom', createdAt.from)
      if (createdAt.to) params.set('createdTo', createdAt.to)
    }
    const emailContains = filterValues.emailContains
    if (typeof emailContains === 'string' && emailContains.trim()) {
      params.set('emailContains', emailContains.trim())
    }
    const booleanFilters: Array<['hasEmail' | 'hasPhone' | 'hasNextInteraction', string]> = [
      ['hasEmail', 'hasEmail'],
      ['hasPhone', 'hasPhone'],
      ['hasNextInteraction', 'hasNextInteraction'],
    ]
    for (const [key, queryKey] of booleanFilters) {
      const value = filterValues[key]
      if (value === true) params.set(queryKey, 'true')
      if (value === false) params.set(queryKey, 'false')
    }
    Object.entries(filterValues).forEach(([key, value]) => {
      if (!key.startsWith('cf_') || value == null) return
      if (Array.isArray(value)) {
        const normalized = value
          .map((item) => {
            if (item == null) return ''
            if (typeof item === 'string') return item.trim()
            return String(item).trim()
          })
          .filter((item) => item.length > 0)
        if (normalized.length) params.set(key, normalized.join(','))
      } else if (typeof value === 'object') {
        return
      } else if (value !== '') {
        const stringValue = typeof value === 'string' ? value.trim() : String(value)
        if (stringValue) params.set(key, stringValue)
      }
    })
    return params.toString()
  }, [filterValues, page, pageSize, search])

  const currentParams = React.useMemo(() => Object.fromEntries(new URLSearchParams(queryParams)), [queryParams])
  const exportConfig = React.useMemo(() => ({
    view: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('customers/companies', { ...currentParams, exportScope: 'view' }, format),
    },
    full: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('customers/companies', { ...currentParams, exportScope: 'full', all: 'true' }, format),
    },
  }), [currentParams])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const res = await apiFetch(`/api/customers/companies?${queryParams}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          const message = typeof data?.error === 'string' ? data.error : t('customers.companies.list.error.load')
          flash(message, 'error')
          return
        }
        const payload: CompaniesResponse = await res.json().catch(() => ({}))
        if (cancelled) return
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items.map((item) => mapApiItem(item as Record<string, unknown>)).filter((row): row is CompanyRow => !!row))
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('customers.companies.list.error.load')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [queryParams, reloadToken, scopeVersion, t])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (company: CompanyRow) => {
    if (!company?.id) return
    const name = company.name || t('customers.companies.list.deleteFallbackName')
    const confirmed = window.confirm(t('customers.companies.list.deleteConfirm', { name }))
    if (!confirmed) return
    try {
      const res = await apiFetch(`/api/customers/companies?id=${encodeURIComponent(company.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      })
      if (!res.ok) {
        const details = await res.json().catch(() => ({}))
        const message = typeof details?.error === 'string' ? details.error : t('customers.companies.list.deleteError')
        throw new Error(message)
      }
      setRows((prev) => prev.filter((row) => row.id !== company.id))
      setTotal((prev) => Math.max(prev - 1, 0))
      handleRefresh()
      flash(t('customers.companies.list.deleteSuccess'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.companies.list.deleteError')
      flash(message, 'error')
    }
  }, [handleRefresh, t])

  const columns = React.useMemo<ColumnDef<CompanyRow>[]>(() => {
    const noValue = <span className="text-muted-foreground text-sm">{t('customers.companies.list.noValue')}</span>
    const renderDictionaryCell = (kind: DictionaryKindKey, rawValue: string | null | undefined) => (
      <DictionaryValue
        value={rawValue}
        map={dictionaryMaps[kind]}
        fallback={rawValue ? <span>{rawValue}</span> : noValue}
        className="text-sm"
        iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card"
        iconClassName="h-4 w-4"
        colorClassName="h-3 w-3 rounded-full"
      />
    )

    const renderCustomFieldCell = (value: unknown) => {
      if (value == null) return noValue
      if (Array.isArray(value)) {
        if (!value.length) return noValue
        const normalized = value
          .map((item) => {
            if (item == null) return ''
            if (typeof item === 'string') return item.trim()
            return String(item).trim()
          })
          .filter((item) => item.length > 0)
        if (!normalized.length) return noValue
        return <span className="text-sm">{normalized.join(', ')}</span>
      }
      if (typeof value === 'boolean') {
        return (
          <span className="text-sm">
            {value
              ? t('customers.companies.list.booleanYes', 'Yes')
              : t('customers.companies.list.booleanNo', 'No')}
          </span>
        )
      }
      const stringValue = typeof value === 'string' ? value.trim() : String(value)
      if (!stringValue) return noValue
      return <span className="text-sm">{stringValue}</span>
    }

    const baseColumns: ColumnDef<CompanyRow>[] = [
      {
        accessorKey: 'name',
        header: t('customers.companies.list.columns.name'),
        cell: ({ row }) => (
          <Link href={`/backend/customers/companies/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'email',
        header: t('customers.companies.list.columns.email'),
        cell: ({ row }) => row.original.email || noValue,
      },
      {
        accessorKey: 'status',
        header: t('customers.companies.list.columns.status'),
        cell: ({ row }) => renderDictionaryCell('statuses', row.original.status),
      },
      {
        accessorKey: 'lifecycleStage',
        header: t('customers.companies.list.columns.lifecycleStage'),
        cell: ({ row }) => renderDictionaryCell('lifecycle-stages', row.original.lifecycleStage),
      },
      {
        accessorKey: 'nextInteractionAt',
        header: t('customers.companies.list.columns.nextInteraction'),
        cell: ({ row }) =>
          row.original.nextInteractionAt
            ? (
              <div className="flex items-start gap-2 text-sm">
                {row.original.nextInteractionIcon ? (
                  <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card">
                    {renderDictionaryIcon(row.original.nextInteractionIcon, 'h-4 w-4')}
                  </span>
                ) : null}
                <div className="flex flex-col">
                  <span>{formatDate(row.original.nextInteractionAt, t('customers.companies.list.noValue'))}</span>
                  {row.original.nextInteractionName ? (
                    <span className="text-xs text-muted-foreground">{row.original.nextInteractionName}</span>
                  ) : null}
                </div>
                {row.original.nextInteractionColor ? (
                  <span className="mt-1">
                    {renderDictionaryColor(row.original.nextInteractionColor, 'h-3 w-3 rounded-full border border-border')}
                  </span>
                ) : null}
              </div>
            )
            : noValue,
      },
      {
        accessorKey: 'source',
        header: t('customers.companies.list.columns.source'),
        cell: ({ row }) => renderDictionaryCell('sources', row.original.source),
      },
    ]

    const customColumns = filterCustomFieldDefs(customFieldDefs, 'list').map<ColumnDef<CompanyRow>>((def) => ({
      accessorKey: `cf_${def.key}`,
      header: def.label || def.key,
      cell: ({ getValue }) => renderCustomFieldCell(getValue()),
    }))

    return [...baseColumns, ...customColumns]
  }, [customFieldDefs, dictionaryMaps, t])

  return (
    <Page>
      <PageBody>
        <DataTable<CompanyRow>
          title={t('customers.companies.list.title')}
          refreshButton={{
            label: t('customers.companies.list.actions.refresh'),
            onRefresh: () => { setSearch(''); setPage(1); handleRefresh() },
          }}
          actions={(
            <Button asChild>
              <Link href="/backend/customers/companies/create">
                {t('customers.companies.list.actions.new')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          exporter={exportConfig}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('customers.companies.list.searchPlaceholder')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => { setFilterValues(values); setPage(1) }}
          onFiltersClear={() => { setFilterValues({}); setPage(1) }}
          entityIds={[E.customers.customer_entity, E.customers.customer_company_profile]}
          onRowClick={(row) => router.push(`/backend/customers/companies/${row.id}`)}
          perspective={{ tableId: 'customers.companies.list' }}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  label: t('customers.companies.list.actions.view'),
                  onSelect: () => { router.push(`/backend/customers/companies/${row.id}`) },
                },
                {
                  label: t('customers.companies.list.actions.openInNewTab'),
                  onSelect: () => window.open(`/backend/customers/companies/${row.id}`, '_blank', 'noopener'),
                },
                {
                  label: t('customers.companies.list.actions.delete'),
                  destructive: true,
                  onSelect: () => handleDelete(row),
                },
              ]}
            />
          )}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
