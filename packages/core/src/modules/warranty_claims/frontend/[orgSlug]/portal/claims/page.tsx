"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { ChevronRight, Plus, ShieldCheck } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { DataTable } from '@open-mercato/ui'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'
import {
  ClaimStatusBadge,
  CLAIM_STATUS_BADGE_VARIANTS,
  type ClaimStatus,
} from '../../../../backend/components/ClaimStatusBadge'

type Props = { params: { orgSlug: string } }

type PortalClaimRow = {
  id: string
  claimNumber: string
  claimType: string
  status: string
  createdAt: string | null
  updatedAt: string | null
}

type PortalClaimsResponse = {
  items: PortalClaimRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  totalIsCapped?: boolean
}

function formatDate(value: string | null, fallback: string, locale: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(locale || undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function WarrantyClaimsPortalListPage({ params }: Props) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, loading } = auth
  const [rows, setRows] = React.useState<PortalClaimRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [stateGroup, setStateGroup] = React.useState<'all' | 'open' | 'resolved'>('all')
  const [tabCounts, setTabCounts] = React.useState<Partial<Record<'all' | 'open' | 'resolved', number>>>({})

  React.useEffect(() => {
    if (!loading && !user) {
      router.replace(`/${params.orgSlug}/portal/login`)
    }
  }, [loading, user, router, params.orgSlug])

  const statusFilter = typeof filterValues.status === 'string' ? filterValues.status : ''

  React.useEffect(() => {
    if (!user) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    const queryParams = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search.trim()) queryParams.set('search', search.trim())
    if (statusFilter) queryParams.set('status', statusFilter)
    else if (stateGroup !== 'all') queryParams.set('stateGroup', stateGroup)
    apiCall<PortalClaimsResponse>(
      `/api/warranty_claims/portal/claims?${queryParams.toString()}`,
    )
      .then((res) => {
        if (cancelled) return
        if (!res.ok || !res.result) {
          setError(t('warranty_claims.portal.error.loadList'))
          setRows([])
          setTotal(0)
          setTotalPages(1)
          return
        }
        setRows(res.result.items)
        setTotal(res.result.total)
        setTotalPages(res.result.totalPages)
        setTotalIsCapped(res.result.totalIsCapped === true)
      })
      .catch(() => {
        if (!cancelled) {
          setError(t('warranty_claims.portal.error.loadList'))
          setRows([])
          setTotal(0)
          setTotalPages(1)
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, pageSize, search, stateGroup, statusFilter, t, user])

  React.useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    const segments: Array<readonly ['all' | 'open' | 'resolved', string | null]> = [
      ['all', null],
      ['open', 'open'],
      ['resolved', 'resolved'],
    ]
    Promise.all(segments.map(async ([segment, state]) => {
      const query = new URLSearchParams({ page: '1', pageSize: '1' })
      if (state) query.set('stateGroup', state)
      const response = await apiCall<PortalClaimsResponse>(
        `/api/warranty_claims/portal/claims?${query.toString()}`,
        { signal: controller.signal },
      )
      if (!response.ok || !response.result) throw new Error('[internal] Failed to load portal claim counts')
      return [segment, response.result.total] as const
    }))
      .then((entries) => {
        if (!controller.signal.aborted) setTabCounts(Object.fromEntries(entries))
      })
      .catch(() => {
        if (!controller.signal.aborted) setTabCounts({})
      })
    return () => controller.abort()
  }, [user])

  const statusOptions = React.useMemo(
    () => (Object.keys(CLAIM_STATUS_BADGE_VARIANTS) as ClaimStatus[]).map((status) => ({
      value: status,
      label: t(`warranty_claims.status.${status}`),
    })),
    [t],
  )

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('warranty_claims.list.filter.status'),
      type: 'select',
      options: statusOptions,
    },
  ], [statusOptions, t])

  const columns = React.useMemo<ColumnDef<PortalClaimRow>[]>(() => [
    {
      id: 'claim',
      header: t('warranty_claims.portal.list.column.claim', 'Claim'),
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-foreground">
            {t(`warranty_claims.claimType.${row.original.claimType}`)}
          </span>
          <span className="block text-overline font-normal text-muted-foreground">{row.original.claimNumber}</span>
        </span>
      ),
      meta: { truncate: true, maxWidth: 360 },
    },
    {
      accessorKey: 'status',
      header: t('warranty_claims.list.column.status'),
      cell: ({ row }) => <ClaimStatusBadge status={row.original.status} />,
      meta: { maxWidth: 180 },
    },
    {
      accessorKey: 'createdAt',
      header: t('warranty_claims.portal.list.column.submittedAt', 'Submitted'),
      cell: ({ row }) => formatDate(row.original.createdAt, t('warranty_claims.portal.value.notAvailable'), locale),
      meta: { maxWidth: 160 },
    },
    {
      accessorKey: 'updatedAt',
      header: t('warranty_claims.list.column.updatedAt'),
      cell: ({ row }) => formatRelativeTime(row.original.updatedAt, { locale }) ?? t('warranty_claims.portal.value.notAvailable'),
      meta: { maxWidth: 160 },
    },
    {
      id: 'open',
      header: '',
      meta: { maxWidth: 48 },
      cell: () => <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />,
    },
  ], [locale, t])

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner /></div>
  }

  if (!user) return null

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 pt-2">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('warranty_claims.portal.listTitle')}</h1>
        <div className="shrink-0">
          <Button asChild>
            <Link href={`/${params.orgSlug}/portal/claims/new`}>
              {t('warranty_claims.portal.newClaim')}
            </Link>
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorMessage label={error} />
      ) : null}

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <Tabs
          value={stateGroup}
          onValueChange={(value) => {
            setStateGroup(value === 'open' || value === 'resolved' ? value : 'all')
            setFilterValues({})
            setPage(1)
          }}
          variant="underline"
        >
          <TabsList className="flex h-auto w-full gap-1 px-7" aria-label={t('warranty_claims.portal.list.tabs.label', 'Claim status')}>
            <TabsTrigger value="all" count={tabCounts.all} className="gap-2 px-4 pb-2 pt-3 [&_[data-slot=tabs-trigger-count]]:h-auto [&_[data-slot=tabs-trigger-count]]:min-w-0 [&_[data-slot=tabs-trigger-count]]:rounded-md [&_[data-slot=tabs-trigger-count]]:bg-muted [&_[data-slot=tabs-trigger-count]]:px-1.5 [&_[data-slot=tabs-trigger-count]]:py-0.5 [&_[data-slot=tabs-trigger-count]]:text-overline [&_[data-slot=tabs-trigger-count]]:text-muted-foreground">{t('warranty_claims.portal.list.tabs.all', 'All')}</TabsTrigger>
            <TabsTrigger value="open" count={tabCounts.open} className="gap-2 px-4 pb-2 pt-3 [&_[data-slot=tabs-trigger-count]]:h-auto [&_[data-slot=tabs-trigger-count]]:min-w-0 [&_[data-slot=tabs-trigger-count]]:rounded-md [&_[data-slot=tabs-trigger-count]]:bg-muted [&_[data-slot=tabs-trigger-count]]:px-1.5 [&_[data-slot=tabs-trigger-count]]:py-0.5 [&_[data-slot=tabs-trigger-count]]:text-overline [&_[data-slot=tabs-trigger-count]]:text-muted-foreground">{t('warranty_claims.portal.list.tabs.open', 'Open')}</TabsTrigger>
            <TabsTrigger value="resolved" count={tabCounts.resolved} className="gap-2 px-4 pb-2 pt-3 [&_[data-slot=tabs-trigger-count]]:h-auto [&_[data-slot=tabs-trigger-count]]:min-w-0 [&_[data-slot=tabs-trigger-count]]:rounded-md [&_[data-slot=tabs-trigger-count]]:bg-muted [&_[data-slot=tabs-trigger-count]]:px-1.5 [&_[data-slot=tabs-trigger-count]]:py-0.5 [&_[data-slot=tabs-trigger-count]]:text-overline [&_[data-slot=tabs-trigger-count]]:text-muted-foreground">{t('warranty_claims.portal.list.tabs.resolved', 'Resolved')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="[&>[data-component-handle]>div:first-child]:px-7 [&>[data-component-handle]>div:first-child]:py-4 [&>[data-component-handle]>div:first-child_[data-slot=button]]:h-8 [&>[data-component-handle]>div:first-child_[data-slot=search-input-wrapper]]:h-8 [&_[data-slot=table-header]_[data-slot=table-row]]:h-9 [&_[data-slot=table-body]_[data-slot=table-row]]:h-16 [&_:has(>[data-slot=search-input-wrapper])]:lg:w-56">
      <DataTable<PortalClaimRow>
        embedded
        columns={columns}
        data={rows}
        isLoading={isLoading}
        error={error}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('warranty_claims.portal.list.searchPlaceholder')}
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={(values) => {
          setFilterValues(values)
          if (typeof values.status === 'string' && values.status) setStateGroup('all')
          setPage(1)
        }}
        onFiltersClear={() => {
          setFilterValues({})
          setPage(1)
        }}
        pagination={{
          page,
          pageSize,
          total,
          totalPages,
          totalIsCapped,
          onPageChange: setPage,
          onPageSizeChange: (nextPageSize) => {
            setPageSize(nextPageSize)
            setPage(1)
          },
        }}
        onRowClick={(row) => {
          router.push(`/${params.orgSlug}/portal/claims/${row.id}`)
        }}
        rowClickActionIds={['open']}
        emptyState={(
          <PortalEmptyState
            icon={<ShieldCheck className="size-5" />}
            title={t('warranty_claims.portal.empty.title')}
            description={t('warranty_claims.portal.empty.description')}
            action={
              <Button asChild>
                <Link href={`/${params.orgSlug}/portal/claims/new`}>
                  <Plus className="size-4" aria-hidden="true" />
                  {t('warranty_claims.portal.newClaim')}
                </Link>
              </Button>
            }
          />
        )}
      />
        </div>
      </section>
    </div>
  )
}
