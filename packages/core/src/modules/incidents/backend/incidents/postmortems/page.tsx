"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { FileText } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type PostmortemStatus = 'draft' | 'published'

type PostmortemApiRecord = {
  id: string
  incidentId: string
  incidentNumber: string
  incidentTitle: string
  status: PostmortemStatus | string
  publishedAt: string | null
  updatedAt: string
  summary: string | null
}

type PostmortemRow = {
  id: string
  incidentId: string
  incidentNumber: string
  incidentTitle: string
  status: string
  publishedAt: string | null
  updatedAt: string
  summary: string | null
}

type PagedResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

type PostmortemFilterValues = {
  status?: PostmortemStatus
}

const statusOptions: PostmortemStatus[] = ['draft', 'published']

const statusVariant: Record<PostmortemStatus, StatusBadgeVariant> = {
  draft: 'neutral',
  published: 'success',
}

const emptyPostmortemsResponse = (page: number, pageSize: number): PagedResponse<PostmortemApiRecord> => ({
  items: [],
  total: 0,
  page,
  pageSize,
})

function mapPostmortem(item: PostmortemApiRecord): PostmortemRow {
  return {
    id: item.id,
    incidentId: item.incidentId,
    incidentNumber: item.incidentNumber,
    incidentTitle: item.incidentTitle,
    status: item.status,
    publishedAt: item.publishedAt,
    updatedAt: item.updatedAt,
    summary: item.summary,
  }
}

function isPostmortemStatus(value: string | null | undefined): value is PostmortemStatus {
  return value === 'draft' || value === 'published'
}

function normalizeFilterValues(values: FilterValues): PostmortemFilterValues {
  const status = typeof values.status === 'string' && isPostmortemStatus(values.status) ? values.status : undefined
  return { status }
}

function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString()
}

function statusLabel(t: ReturnType<typeof useT>, status: string): string {
  if (status === 'draft') return t('incidents.postmortem.list.status.draft', 'Draft')
  if (status === 'published') return t('incidents.postmortem.list.status.published', 'Published')
  return status
}

function buildIncidentHref(row: PostmortemRow): string {
  return `/backend/incidents/${encodeURIComponent(row.incidentId)}`
}

export default function IncidentPostmortemsPage() {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<PostmortemRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)
  const [total, setTotal] = React.useState(0)
  const [filterValues, setFilterValues] = React.useState<PostmortemFilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [cacheStatus, setCacheStatus] = React.useState<'hit' | 'miss' | null>(null)

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (filterValues.status) params.set('status', filterValues.status)
    const fallback = emptyPostmortemsResponse(page, pageSize)

    try {
      const result = await apiCall<PagedResponse<PostmortemApiRecord>>(
        `/api/incidents/postmortems?${params.toString()}`,
        undefined,
        { fallback },
      )
      setCacheStatus(result.cacheStatus)
      if (!result.ok) {
        const message = t('incidents.postmortem.list.error.load', 'Failed to load postmortems.')
        setRows([])
        setTotal(0)
        setError(message)
        flash(message, 'error')
        return
      }
      const payload = result.result ?? fallback
      setRows(payload.items.map(mapPostmortem))
      setTotal(payload.total)
    } catch {
      const message = t('incidents.postmortem.list.error.load', 'Failed to load postmortems.')
      setRows([])
      setTotal(0)
      setError(message)
      flash(message, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [filterValues.status, page, pageSize, t])

  React.useEffect(() => {
    loadData().catch(() => {
      const message = t('incidents.postmortem.list.error.load', 'Failed to load postmortems.')
      setError(message)
      flash(message, 'error')
      setIsLoading(false)
    })
  }, [loadData, t])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('incidents.postmortem.list.filters.status', 'Status'),
      type: 'select',
      options: statusOptions.map((status) => ({
        value: status,
        label: statusLabel(t, status),
      })),
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<PostmortemRow>[]>(() => [
    {
      accessorKey: 'incidentNumber',
      header: t('incidents.postmortem.list.columns.incident', 'Incident'),
      cell: ({ row }) => (
        <Link href={buildIncidentHref(row.original)} className="font-medium hover:underline" title={row.original.incidentNumber}>
          {row.original.incidentNumber}
        </Link>
      ),
      meta: { alwaysVisible: true, truncate: true, maxWidth: 160 },
    },
    {
      accessorKey: 'incidentTitle',
      header: t('incidents.postmortem.list.columns.title', 'Title'),
      cell: ({ row }) => <span title={row.original.incidentTitle}>{row.original.incidentTitle}</span>,
      meta: { alwaysVisible: true, truncate: true, maxWidth: 380 },
    },
    {
      accessorKey: 'status',
      header: t('incidents.postmortem.list.columns.status', 'Status'),
      cell: ({ row }) => {
        const status = row.original.status
        const variant = isPostmortemStatus(status) ? statusVariant[status] : 'neutral'
        return (
          <StatusBadge variant={variant} dot>
            {statusLabel(t, status)}
          </StatusBadge>
        )
      },
      meta: { filterType: 'select', filterOptions: statusOptions.map((status) => ({ value: status, label: statusLabel(t, status) })) },
    },
    {
      accessorKey: 'publishedAt',
      header: t('incidents.postmortem.list.columns.publishedAt', 'Published'),
      cell: ({ row }) => {
        const publishedAt = formatDate(row.original.publishedAt, t('incidents.postmortem.list.unpublished', 'Unpublished'))
        return <span title={publishedAt}>{publishedAt}</span>
      },
      meta: { truncate: true, maxWidth: 180 },
    },
    {
      accessorKey: 'summary',
      header: t('incidents.postmortem.list.columns.summary', 'Summary'),
      cell: ({ row }) => {
        const summary = row.original.summary ?? t('incidents.postmortem.list.summary.empty', 'No summary')
        return <span title={summary}>{summary}</span>
      },
      meta: { truncate: true, maxWidth: 480 },
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable<PostmortemRow>
          title={t('incidents.postmortem.list.title', 'Incident postmortems')}
          columns={columns}
          data={rows}
          filters={filterDefs}
          filterValues={filterValues}
          onFiltersApply={(values) => {
            setFilterValues(normalizeFilterValues(values))
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilterValues({})
            setPage(1)
          }}
          perspective={{ tableId: 'incidents.postmortems.list' }}
          extensionTableId="incidents.postmortems"
          onRowClick={(row) => router.push(buildIncidentHref(row))}
          emptyState={(
            <EmptyState
              icon={<FileText className="size-6" aria-hidden="true" />}
              title={t('incidents.postmortem.list.empty.title', 'No postmortems yet')}
              description={t('incidents.postmortem.list.empty.description', 'Published and draft postmortems will appear here.')}
            />
          )}
          pagination={{
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
            cacheStatus,
            pageSizeOptions: [10, 25, 50, 100],
            onPageChange: setPage,
            onPageSizeChange: (nextPageSize) => {
              setPageSize(Math.min(nextPageSize, 100))
              setPage(1)
            },
          }}
          isLoading={isLoading}
          error={error}
        />
      </PageBody>
    </Page>
  )
}
