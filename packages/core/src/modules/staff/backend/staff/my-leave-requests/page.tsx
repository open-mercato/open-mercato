"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const PAGE_SIZE = 50

type LeaveRequestRow = {
  id: string
  startDate: string | null
  endDate: string | null
  status: 'pending' | 'approved' | 'rejected'
  reason: string | null
  updatedAt: string | null
}

type LeaveRequestsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
  viewer?: { memberId?: string | null }
}

export default function StaffMyLeaveRequestsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<LeaveRequestRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'startDate', desc: true }])
  const [memberId, setMemberId] = React.useState<string | null>(null)

  const labels = React.useMemo(() => ({
    title: t('staff.leaveRequests.my.title', 'My leave requests'),
    table: {
      dates: t('staff.leaveRequests.table.dates', 'Dates'),
      status: t('staff.leaveRequests.table.status', 'Status'),
      reason: t('staff.leaveRequests.table.reason', 'Reason'),
      updatedAt: t('staff.leaveRequests.table.updatedAt', 'Updated'),
      empty: t('staff.leaveRequests.table.empty', 'No leave requests yet.'),
      search: t('staff.leaveRequests.table.search', 'Search leave requests...'),
    },
    actions: {
      add: t('staff.leaveRequests.actions.add', 'New request'),
      refresh: t('staff.leaveRequests.actions.refresh', 'Refresh'),
      createProfile: t('staff.leaveRequests.actions.createProfile', 'Create my profile'),
    },
    errors: {
      load: t('staff.leaveRequests.errors.load', 'Failed to load leave requests.'),
    },
  }), [t])

  const columns = React.useMemo<ColumnDef<LeaveRequestRow>[]>(() => [
    {
      accessorKey: 'startDate',
      header: labels.table.dates,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => formatDateRange(row.original.startDate, row.original.endDate),
    },
    {
      accessorKey: 'status',
      header: labels.table.status,
      meta: { priority: 2 },
      cell: ({ row }) => (
        <Badge variant={resolveStatusVariant(row.original.status)}>
          {t(`staff.leaveRequests.status.${row.original.status}`, row.original.status)}
        </Badge>
      ),
    },
    {
      accessorKey: 'reason',
      header: labels.table.reason,
      meta: { priority: 3, truncate: true, maxWidth: '240px' },
      cell: ({ row }) => row.original.reason ?? '-',
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 4 },
      cell: ({ row }) => formatDateLabel(row.original.updatedAt),
    },
  ], [labels.table, t])

  const loadRows = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (search.trim().length) params.set('search', search.trim())
      const activeSort = sorting[0]
      if (activeSort?.id) {
        params.set('sortField', activeSort.id)
        params.set('sortDir', activeSort.desc ? 'desc' : 'asc')
      }
      const payload = await readApiResultOrThrow<LeaveRequestsResponse>(
        `/api/staff/leave-requests?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapLeaveRequest))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      const viewerMemberId = typeof payload.viewer?.memberId === 'string' ? payload.viewer.memberId : null
      setMemberId(viewerMemberId)
    } catch {
      setRows([])
      setTotal(0)
      setTotalPages(1)
      setMemberId(null)
    } finally {
      setIsLoading(false)
    }
  }, [labels.errors.load, page, search, sorting])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows, scopeVersion])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const emptyState = memberId
    ? <p className="py-8 text-center text-sm text-muted-foreground">{labels.table.empty}</p>
    : (
      <div className="py-8 text-center text-sm text-muted-foreground space-y-3">
        <p>{t('staff.leaveRequests.empty.profileRequired', 'Create your team member profile to submit leave requests.')}</p>
        <Button asChild size="sm" variant="outline">
          <Link href="/backend/staff/profile/create">{labels.actions.createProfile}</Link>
        </Button>
      </div>
    )

  return (
    <Page>
      <PageBody>
        <DataTable<LeaveRequestRow>
          title={labels.title}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={labels.table.search}
          emptyState={emptyState}
          actions={memberId ? (
            <Button asChild size="sm">
              <Link href="/backend/staff/my-leave-requests/create">{labels.actions.add}</Link>
            </Button>
          ) : null}
          refreshButton={{
            label: labels.actions.refresh,
            onRefresh: loadRows,
            isRefreshing: isLoading,
          }}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          onRowClick={(row) => {
            router.push(`/backend/staff/my-leave-requests/${encodeURIComponent(row.id)}`)
          }}
        />
      </PageBody>
    </Page>
  )
}

function mapLeaveRequest(item: Record<string, unknown>): LeaveRequestRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const startDate = typeof item.startDate === 'string'
    ? item.startDate
    : typeof item.start_date === 'string'
      ? item.start_date
      : null
  const endDate = typeof item.endDate === 'string'
    ? item.endDate
    : typeof item.end_date === 'string'
      ? item.end_date
      : null
  const status = item.status === 'approved' || item.status === 'rejected' ? item.status : 'pending'
  const reason = typeof item.unavailabilityReasonValue === 'string'
    ? item.unavailabilityReasonValue
    : typeof item.unavailability_reason_value === 'string'
      ? item.unavailability_reason_value
      : null
  const updatedAt = typeof item.updatedAt === 'string'
    ? item.updatedAt
    : typeof item.updated_at === 'string'
      ? item.updated_at
      : null
  return {
    id,
    startDate,
    endDate,
    status,
    reason,
    updatedAt,
  }
}

function formatDateRange(start?: string | null, end?: string | null): string {
  const startLabel = formatDateLabel(start)
  const endLabel = formatDateLabel(end)
  if (startLabel && endLabel) return `${startLabel} -> ${endLabel}`
  return startLabel || endLabel || '-'
}

function formatDateLabel(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

function resolveStatusVariant(status: 'pending' | 'approved' | 'rejected') {
  if (status === 'approved') return 'default'
  if (status === 'rejected') return 'destructive'
  return 'secondary'
}
