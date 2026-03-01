"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type InstructorRow = {
  id: string
  displayName: string
  slug: string
  headline: string | null
  avatarUrl: string | null
  specializations: string[] | null
  experienceYears: number | null
  hourlyRate: string | null
  currency: string
  isAvailable: boolean
  isVerified: boolean
  isActive: boolean
  createdAt: string | null
}

type InstructorsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  totalPages?: number
}

function mapApiItem(item: Record<string, unknown>): InstructorRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    displayName: typeof item.display_name === 'string' ? item.display_name : '',
    slug: typeof item.slug === 'string' ? item.slug : '',
    headline: typeof item.headline === 'string' ? item.headline : null,
    avatarUrl: typeof item.avatar_url === 'string' ? item.avatar_url : null,
    specializations: Array.isArray(item.specializations) ? item.specializations as string[] : null,
    experienceYears: typeof item.experience_years === 'number' ? item.experience_years : null,
    hourlyRate: typeof item.hourly_rate === 'string' ? item.hourly_rate : null,
    currency: typeof item.currency === 'string' ? item.currency : 'USD',
    isAvailable: item.is_available === true,
    isVerified: item.is_verified === true,
    isActive: item.is_active !== false,
    createdAt: typeof item.created_at === 'string' ? item.created_at : null,
  }
}

export default function InstructorsListPage() {
  const [rows, setRows] = React.useState<InstructorRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const router = useRouter()

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'isAvailable',
      label: t('instructors.list.filters.available', 'Available'),
      type: 'checkbox',
    },
    {
      id: 'isVerified',
      label: t('instructors.list.filters.verified', 'Verified'),
      type: 'checkbox',
    },
  ], [t])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (search.trim()) params.set('search', search.trim())
    if (filterValues.isAvailable === true) params.set('isAvailable', 'true')
    if (filterValues.isAvailable === false) params.set('isAvailable', 'false')
    if (filterValues.isVerified === true) params.set('isVerified', 'true')
    if (filterValues.isVerified === false) params.set('isVerified', 'false')
    return params.toString()
  }, [filterValues, page, pageSize, search])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: InstructorsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<InstructorsResponse>(`/api/instructors?${queryParams}`, undefined, { fallback })
        if (!call.ok) {
          const errorPayload = call.result as { error?: string } | undefined
          const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('instructors.list.error.load', 'Failed to load instructors.')
          flash(message, 'error')
          return
        }
        const payload = call.result ?? fallback
        if (cancelled) return
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items.map((item) => mapApiItem(item as Record<string, unknown>)).filter((row): row is InstructorRow => !!row))
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('instructors.list.error.load', 'Failed to load instructors.')
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

  const handleDelete = React.useCallback(async (instructor: InstructorRow) => {
    if (!instructor?.id) return
    const name = instructor.displayName || t('instructors.list.deleteFallbackName', 'this instructor')
    const confirmed = window.confirm(t('instructors.list.deleteConfirm', 'Are you sure you want to delete {name}?', { name }))
    if (!confirmed) return
    try {
      await apiCallOrThrow(
        `/api/instructors?id=${encodeURIComponent(instructor.id)}`,
        { method: 'DELETE', headers: { 'content-type': 'application/json' } },
        { errorMessage: t('instructors.list.deleteError', 'Failed to delete instructor.') },
      )
      setRows((prev) => prev.filter((row) => row.id !== instructor.id))
      setTotal((prev) => Math.max(prev - 1, 0))
      handleRefresh()
      flash(t('instructors.list.deleteSuccess', 'Instructor deleted.'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('instructors.list.deleteError', 'Failed to delete instructor.')
      flash(message, 'error')
    }
  }, [handleRefresh, t])

  const columns = React.useMemo<ColumnDef<InstructorRow>[]>(() => {
    const noValue = <span className="text-muted-foreground text-sm">—</span>
    return [
      {
        accessorKey: 'displayName',
        header: t('instructors.list.columns.name', 'Name'),
        cell: ({ row }) => (
          <Link href={`/backend/instructors/${row.original.id}`} className="font-medium hover:underline">
            {row.original.displayName}
          </Link>
        ),
      },
      {
        accessorKey: 'headline',
        header: t('instructors.list.columns.headline', 'Headline'),
        cell: ({ row }) => row.original.headline || noValue,
      },
      {
        accessorKey: 'specializations',
        header: t('instructors.list.columns.specializations', 'Specializations'),
        cell: ({ row }) => {
          const specs = row.original.specializations
          if (!specs || specs.length === 0) return noValue
          return (
            <div className="flex flex-wrap gap-1">
              {specs.slice(0, 3).map((spec) => (
                <span key={spec} className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {spec}
                </span>
              ))}
              {specs.length > 3 && (
                <span className="text-xs text-muted-foreground">+{specs.length - 3}</span>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'isAvailable',
        header: t('instructors.list.columns.available', 'Available'),
        cell: ({ row }) => (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${row.original.isAvailable ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
            {row.original.isAvailable ? t('instructors.list.available', 'Available') : t('instructors.list.unavailable', 'Unavailable')}
          </span>
        ),
      },
      {
        accessorKey: 'isVerified',
        header: t('instructors.list.columns.verified', 'Verified'),
        cell: ({ row }) => (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${row.original.isVerified ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'}`}>
            {row.original.isVerified ? t('instructors.list.verified', 'Verified') : t('instructors.list.unverified', 'Unverified')}
          </span>
        ),
      },
      {
        accessorKey: 'hourlyRate',
        header: t('instructors.list.columns.rate', 'Rate'),
        cell: ({ row }) => {
          if (!row.original.hourlyRate) return noValue
          return <span className="text-sm">{row.original.currency} {row.original.hourlyRate}/hr</span>
        },
      },
    ]
  }, [t])

  return (
    <Page>
      <PageBody>
        <DataTable<InstructorRow>
          title={t('instructors.list.title', 'Instructors')}
          refreshButton={{
            label: t('instructors.list.actions.refresh', 'Refresh'),
            onRefresh: () => { setSearch(''); setPage(1); handleRefresh() },
          }}
          actions={(
            <Button asChild>
              <Link href="/backend/instructors/create">
                {t('instructors.list.actions.new', 'Add Instructor')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('instructors.list.searchPlaceholder', 'Search instructors...')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => { setFilterValues(values); setPage(1) }}
          onFiltersClear={() => { setFilterValues({}); setPage(1) }}
          perspective={{ tableId: 'instructors.list' }}
          onRowClick={(row) => router.push(`/backend/instructors/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  label: t('instructors.list.actions.view', 'View'),
                  onSelect: () => { router.push(`/backend/instructors/${row.id}`) },
                },
                {
                  label: t('instructors.list.actions.openInNewTab', 'Open in new tab'),
                  onSelect: () => window.open(`/backend/instructors/${row.id}`, '_blank', 'noopener'),
                },
                {
                  label: t('instructors.list.actions.delete', 'Delete'),
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
