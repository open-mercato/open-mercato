"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { E } from '#generated/entities.ids.generated'

type LeadRow = {
  id: string
  title: string
  status: string | null
  source: string | null
  companyName: string | null
  contactFirstName: string | null
  contactLastName: string | null
  estimatedValueAmount: number | null
  estimatedValueCurrency: string | null
  updatedAt: string | null
}

type LeadsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 20

const LEAD_STATUSES = ['open', 'in_progress', 'qualified', 'rejected'] as const

function statusLabelKey(status: string): string {
  switch (status) {
    case 'open':
      return 'customers.leads.status.open'
    case 'in_progress':
      return 'customers.leads.status.in_progress'
    case 'qualified':
      return 'customers.leads.status.qualified'
    case 'rejected':
      return 'customers.leads.status.rejected'
    default:
      return 'customers.leads.status.open'
  }
}

function formatCurrency(amount: number | null, currency: string | null, fallback: string): string {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return fallback
  try {
    if (currency && currency.trim().length) {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
    }
    return new Intl.NumberFormat(undefined, { style: 'decimal', maximumFractionDigits: 2 }).format(amount)
  } catch {
    return fallback
  }
}

function mapLead(item: Record<string, unknown>): LeadRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const title = typeof item.title === 'string' ? item.title : ''
  const status = typeof item.status === 'string' ? item.status : null
  const source = typeof item.source === 'string' ? item.source : null
  const companyName =
    typeof item.companyName === 'string' ? item.companyName :
    typeof item.company_name === 'string' ? item.company_name : null
  const contactFirstName =
    typeof item.contactFirstName === 'string' ? item.contactFirstName :
    typeof item.contact_first_name === 'string' ? item.contact_first_name : null
  const contactLastName =
    typeof item.contactLastName === 'string' ? item.contactLastName :
    typeof item.contact_last_name === 'string' ? item.contact_last_name : null
  const amountRaw = item.estimatedValueAmount ?? item.estimated_value_amount
  const estimatedValueAmount =
    typeof amountRaw === 'number'
      ? amountRaw
      : typeof amountRaw === 'string' && amountRaw.trim()
        ? Number(amountRaw)
        : null
  const estimatedValueCurrency =
    typeof item.estimatedValueCurrency === 'string' && item.estimatedValueCurrency.trim().length
      ? item.estimatedValueCurrency.trim().toUpperCase()
      : typeof item.estimated_value_currency === 'string' && item.estimated_value_currency.trim().length
        ? item.estimated_value_currency.trim().toUpperCase()
        : null
  const updatedAt =
    typeof item.updatedAt === 'string' ? item.updatedAt :
    typeof item.updated_at === 'string' ? item.updated_at : null
  return {
    id,
    title,
    status,
    source,
    companyName,
    contactFirstName,
    contactLastName,
    estimatedValueAmount,
    estimatedValueCurrency,
    updatedAt,
  }
}

export default function LeadsPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<LeadRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(0)
  const [page, setPage] = React.useState(() => {
    const raw = searchParams?.get('page')
    const parsed = raw ? Number(raw) : 1
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1
  })
  const [pageSize, setPageSize] = React.useState(PAGE_SIZE)
  const [search, setSearch] = React.useState(() => searchParams?.get('search') ?? '')
  const [statusFilter, setStatusFilter] = React.useState<string | null>(
    () => searchParams?.get('status') ?? null,
  )
  const [sorting, setSorting] = React.useState<{ field: string; dir: 'asc' | 'desc' } | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleDeleteLead = React.useCallback(
    async (leadId: string) => {
      const confirmed = await confirm({
        title: t('customers.leads.detail.deleteConfirm', 'Delete this lead? This action cannot be undone.'),
        variant: 'destructive',
      })
      if (!confirmed) return
      setPendingDeleteId(leadId)
      try {
        await deleteCrud('customers/leads', leadId, {
          errorMessage: t('customers.leads.detail.deleteError', 'Failed to delete lead.'),
        })
        flash(t('customers.leads.detail.deleteSuccess', 'Lead deleted.'), 'success')
        setReloadToken((token) => token + 1)
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('customers.leads.detail.deleteError', 'Failed to delete lead.')
        flash(message, 'error')
      } finally {
        setPendingDeleteId(null)
      }
    },
    [confirm, t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function loadLeads() {
      setIsLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', String(pageSize))
        if (search.trim()) params.set('search', search.trim())
        if (statusFilter) params.set('status', statusFilter)
        if (sorting) {
          params.set('sortField', sorting.field)
          params.set('sortDir', sorting.dir)
        }
        const call = await apiCall<LeadsResponse>(`/api/customers/leads?${params.toString()}`)
        if (cancelled) return
        if (!call.ok) {
          setError(t('customers.leads.list.error', 'Failed to load leads.'))
          setRows([])
          setTotal(0)
          setTotalPages(0)
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const mapped = items
          .map((item) => mapLead(item as Record<string, unknown>))
          .filter((row): row is LeadRow => row !== null)
        setRows(mapped)
        setTotal(call.result?.total ?? mapped.length)
        setTotalPages(call.result?.totalPages ?? Math.max(1, Math.ceil(mapped.length / pageSize)))
      } catch {
        if (!cancelled) {
          setError(t('customers.leads.list.error', 'Failed to load leads.'))
          setRows([])
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    loadLeads().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [page, pageSize, search, statusFilter, sorting, scopeVersion, reloadToken, t])

  const columns = React.useMemo<ColumnDef<LeadRow>[]>(() => {
    const noValue = <span className="text-muted-foreground text-sm">{t('customers.leads.list.noValue', '—')}</span>
    return [
      {
        accessorKey: 'title',
        header: t('customers.leads.list.columns.title'),
        meta: { alwaysVisible: true, columnChooserGroup: 'Basic Info', filterKey: 'title' },
        cell: ({ row }) => <span className="font-medium text-sm">{row.original.title}</span>,
      },
      {
        accessorKey: 'status',
        header: t('customers.leads.list.columns.status'),
        meta: { filterType: 'select' as const, columnChooserGroup: 'Basic Info', filterKey: 'status' },
        cell: ({ row }) => {
          const status = row.original.status
          if (!status) return noValue
          return <span className="text-sm">{t(statusLabelKey(status), status)}</span>
        },
      },
      {
        accessorKey: 'companyName',
        header: t('customers.leads.list.columns.companyName'),
        meta: { columnChooserGroup: 'Basic Info', filterKey: 'company_name' },
        cell: ({ row }) => {
          const name = row.original.companyName
          return name ? <span className="text-sm">{name}</span> : noValue
        },
      },
      {
        accessorKey: 'contactName',
        header: t('customers.leads.list.columns.contactName'),
        meta: { columnChooserGroup: 'Basic Info' },
        cell: ({ row }) => {
          const first = row.original.contactFirstName
          const last = row.original.contactLastName
          const name = [first, last].filter(Boolean).join(' ').trim()
          return name ? <span className="text-sm">{name}</span> : noValue
        },
      },
      {
        accessorKey: 'source',
        header: t('customers.leads.list.columns.source'),
        meta: { columnChooserGroup: 'Basic Info', filterKey: 'source' },
        cell: ({ row }) => {
          const source = row.original.source
          return source ? <span className="text-sm">{source}</span> : noValue
        },
      },
      {
        accessorKey: 'estimatedValue',
        header: t('customers.leads.list.columns.value'),
        meta: { columnChooserGroup: 'Basic Info' },
        cell: ({ row }) => {
          const amount = row.original.estimatedValueAmount
          const currency = row.original.estimatedValueCurrency
          if (amount === null) return noValue
          return <span className="text-sm">{formatCurrency(amount, currency, t('customers.leads.list.noValue', '—'))}</span>
        },
      },
    ]
  }, [t])

  const filters = React.useMemo(
    () => [
      {
        id: 'status',
        label: t('customers.leads.list.filters.status'),
        type: 'select' as const,
        options: LEAD_STATUSES.map((status) => ({
          value: status,
          label: t(statusLabelKey(status), status),
        })),
      },
    ],
    [t],
  )

  const filterValues = React.useMemo(
    () => ({
      status: statusFilter ?? '',
    }),
    [statusFilter],
  )

  const handleFiltersApply = React.useCallback((values: Record<string, string>) => {
    setStatusFilter(values.status || null)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setStatusFilter(null)
    setPage(1)
  }, [])

  const handlePageSizeChange = React.useCallback((newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }, [])

  return (
    <Page>
      <PageBody>
        {isLoading && rows.length === 0 ? (
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('customers.leads.list.loading', 'Loading leads…')}</span>
          </div>
        ) : error ? (
          <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground">
            <p>{error}</p>
            <Button variant="outline" onClick={handleRefresh}>
              {t('customers.leads.list.retry', 'Retry')}
            </Button>
          </div>
        ) : (
          <DataTable<LeadRow>
            stickyFirstColumn
            title={t('customers.leads.list.title', 'Leads')}
            actions={
              <Button asChild>
                <Link href="/backend/customers/leads/create">
                  {t('customers.leads.list.actions.new', 'New lead')}
                </Link>
              </Button>
            }
            columns={columns}
            columnChooser={{ auto: true }}
            data={rows}
            onRowClick={(row) => {
              router.push(`/backend/customers/leads/${row.id}`)
            }}
            rowActions={(row) => {
              const isDeleting = pendingDeleteId === row.id
              return (
                <RowActions
                  items={[
                    {
                      id: 'edit',
                      label: t('customers.leads.list.actions.edit', 'Edit'),
                      onSelect: () => {
                        router.push(`/backend/customers/leads/${row.id}`)
                      },
                    },
                    {
                      id: 'open-new-tab',
                      label: t('customers.leads.list.actions.openInNewTab', 'Open in new tab'),
                      onSelect: () => {
                        if (typeof window !== 'undefined') {
                          window.open(`/backend/customers/leads/${row.id}`, '_blank', 'noopener')
                        }
                      },
                    },
                    {
                      id: 'delete',
                      label: isDeleting
                        ? t('customers.leads.list.actions.deleting', 'Deleting…')
                        : t('customers.leads.list.actions.delete', 'Delete'),
                      destructive: true,
                      onSelect: () => handleDeleteLead(row.id),
                    },
                  ]}
                />
              )
            }}
            sortable
            sorting={sorting ? [{ id: sorting.field, desc: sorting.dir === 'desc' }] : []}
            onSortingChange={(next) => {
              const entry = next[0]
              if (entry) {
                setSorting({ field: entry.id, dir: entry.desc ? 'desc' : 'asc' })
              } else {
                setSorting(null)
              }
            }}
            searchValue={search}
            onSearchChange={handleSearchChange}
            searchPlaceholder={t('customers.leads.list.searchPlaceholder', 'Search leads…')}
            filters={filters}
            filterValues={filterValues}
            onFiltersApply={handleFiltersApply}
            onFiltersClear={handleFiltersClear}
            pagination={{
              page,
              pageSize,
              total,
              totalPages,
              onPageChange: (nextPage) => setPage(nextPage),
              pageSizeOptions: [10, 25, 50, 100],
              onPageSizeChange: handlePageSizeChange,
            }}
            isLoading={isLoading}
            refreshButton={{
              label: t('customers.leads.list.refresh', 'Refresh'),
              onRefresh: handleRefresh,
            }}
            entityId={E.customers.customer_lead}
            perspective={{ tableId: 'customers.leads.list' }}
            emptyState={
              <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
                <p>{t('customers.leads.list.emptyTitle', 'No leads yet')}</p>
                <Button asChild>
                  <Link href="/backend/customers/leads/create">
                    {t('customers.leads.list.emptyAction', 'Create lead')}
                  </Link>
                </Button>
              </div>
            }
          />
        )}
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
