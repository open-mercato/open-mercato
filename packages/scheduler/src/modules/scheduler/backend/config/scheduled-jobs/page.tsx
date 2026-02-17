"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type ScheduleRow = {
  id: string
  name: string
  description?: string | null
  scopeType: 'system' | 'organization' | 'tenant'
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  targetType: 'queue' | 'command'
  targetQueue?: string | null
  targetCommand?: string | null
  isEnabled: boolean
  sourceType: 'user' | 'module'
  sourceModule?: string | null
  nextRunAt?: string | null
  lastRunAt?: string | null
}

type SchedulesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  totalPages?: number
}

function mapApiItem(item: Record<string, unknown>): ScheduleRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null

  return {
    id,
    name: typeof item.name === 'string' ? item.name : '',
    description: typeof item.description === 'string' ? item.description : null,
    scopeType: (item.scopeType === 'system' || item.scopeType === 'organization' || item.scopeType === 'tenant')
      ? item.scopeType
      : 'tenant',
    scheduleType: (item.scheduleType === 'cron' || item.scheduleType === 'interval')
      ? item.scheduleType
      : 'cron',
    scheduleValue: typeof item.scheduleValue === 'string' ? item.scheduleValue : '',
    timezone: typeof item.timezone === 'string' ? item.timezone : 'UTC',
    targetType: (item.targetType === 'queue' || item.targetType === 'command')
      ? item.targetType
      : 'queue',
    targetQueue: typeof item.targetQueue === 'string' ? item.targetQueue : null,
    targetCommand: typeof item.targetCommand === 'string' ? item.targetCommand : null,
    isEnabled: item.isEnabled === true,
    sourceType: (item.sourceType === 'user' || item.sourceType === 'module')
      ? item.sourceType
      : 'user',
    sourceModule: typeof item.sourceModule === 'string' ? item.sourceModule : null,
    nextRunAt: typeof item.nextRunAt === 'string' ? item.nextRunAt : null,
    lastRunAt: typeof item.lastRunAt === 'string' ? item.lastRunAt : null,
  }
}

function formatDateTime(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString()
}

export default function SchedulerPage() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const router = useRouter()
  const [rows, setRows] = React.useState<ScheduleRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(false)
  const scopeVersion = useOrganizationScopeVersion()

  const fetchSchedules = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      })
      if (search) params.set('search', search)

      const { result } = await apiCallOrThrow<SchedulesResponse>(
        `/api/scheduler/jobs?${params.toString()}`
      )

      const items = result?.items ?? []
      const mapped = items.map(mapApiItem).filter((x): x is ScheduleRow => x !== null)
      setRows(mapped)
      setTotal(result?.total ?? 0)
      setTotalPages(result?.totalPages ?? 1)
    } catch (error) {
      flash(t('scheduler.error.fetch_failed', 'Failed to load schedules'), 'error')
      setRows([])
      setTotal(0)
      setTotalPages(1)
    } finally {
      setIsLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, search, scopeVersion, t])

  React.useEffect(() => {
    fetchSchedules()
  }, [fetchSchedules])

  const handleDelete = React.useCallback(
    async (row: ScheduleRow) => {
      const confirmed = await confirm({
        title: t('scheduler.confirm.delete', 'Are you sure you want to delete this schedule?'),
        variant: 'destructive',
      })
      if (!confirmed) {
        return
      }

      try {
        await apiCallOrThrow(`/api/scheduler/jobs`, {
          method: 'DELETE',
          body: JSON.stringify({ id: row.id }),
        })
        flash(t('scheduler.success.deleted', 'Schedule deleted successfully'), 'success')
        fetchSchedules()
      } catch (error) {
        flash(t('scheduler.error.delete_failed', 'Failed to delete schedule'), 'error')
      }
    },
    [confirm, t, fetchSchedules]
  )

  const handleTrigger = React.useCallback(
    async (row: ScheduleRow) => {
      try {
        await apiCallOrThrow(`/api/scheduler/trigger`, {
          method: 'POST',
          body: JSON.stringify({ id: row.id }),
        })
        flash(t('scheduler.success.triggered', 'Schedule triggered successfully'), 'success')
      } catch (error) {
        const message = error instanceof Error ? error.message : t('scheduler.error.trigger_failed', 'Failed to trigger schedule')
        flash(message, 'error')
      }
    },
    [t]
  )

  const columns = React.useMemo<ColumnDef<ScheduleRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: t('scheduler.field.name', 'Name'),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        id: 'scheduleType',
        accessorKey: 'scheduleType',
        header: t('scheduler.field.schedule_type', 'Type'),
        cell: ({ row }) => (
          <span className="capitalize">{row.original.scheduleType}</span>
        ),
      },
      {
        id: 'scheduleValue',
        accessorKey: 'scheduleValue',
        header: t('scheduler.field.schedule', 'Schedule'),
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.scheduleValue}
          </span>
        ),
      },
      {
        id: 'targetType',
        accessorKey: 'targetType',
        header: t('scheduler.field.target', 'Target'),
        cell: ({ row }) => {
          const target = row.original.targetType === 'queue'
            ? row.original.targetQueue
            : row.original.targetCommand
          return (
            <div className="flex flex-col">
              <span className="text-xs text-gray-500 capitalize">{row.original.targetType}</span>
              <span className="text-sm">{target || '-'}</span>
            </div>
          )
        },
      },
      {
        id: 'nextRunAt',
        accessorKey: 'nextRunAt',
        header: t('scheduler.field.next_run', 'Next Run'),
        cell: ({ row }) => (
          <span className="text-sm">
            {formatDateTime(row.original.nextRunAt, '-')}
          </span>
        ),
      },
      {
        id: 'isEnabled',
        accessorKey: 'isEnabled',
        header: t('scheduler.field.active', 'Active'),
        cell: ({ row }) => <BooleanIcon value={row.original.isEnabled} />,
      },
      {
        id: 'sourceType',
        accessorKey: 'sourceType',
        header: t('scheduler.field.source', 'Source'),
        cell: ({ row }) => (
          <span className="text-xs capitalize">
            {row.original.sourceType}
            {row.original.sourceModule && ` (${row.original.sourceModule})`}
          </span>
        ),
      },
    ],
    [t]
  )

  const rowActions = React.useCallback(
    (row: ScheduleRow): RowActionItem[] => [
      {
        id: 'view',
        label: t('scheduler.action.view', 'View Details'),
        onSelect: () => router.push(`/backend/config/scheduled-jobs/${row.id}`),
      },
      {
        id: 'edit',
        label: t('scheduler.action.edit', 'Edit'),
        onSelect: () => router.push(`/backend/config/scheduled-jobs/${row.id}/edit`),
      },
      {
        id: 'trigger',
        label: t('scheduler.action.trigger', 'Run Now'),
        onSelect: () => handleTrigger(row),
      },
      {
        id: 'delete',
        label: t('scheduler.action.delete', 'Delete'),
        onSelect: () => handleDelete(row),
        destructive: true,
      },
    ],
    [t, router, handleDelete, handleTrigger]
  )

  return (
    <Page>
      <PageBody>
        <DataTable<ScheduleRow>
          title={t('scheduler.title', 'Scheduled Jobs')}
          actions={
            <Button onClick={() => router.push('/backend/config/scheduled-jobs/new')}>
              {t('scheduler.action.create', 'New Schedule')}
            </Button>
          }
          columns={columns}
          data={rows}
          onRowClick={(row) => router.push(`/backend/config/scheduled-jobs/${row.id}`)}
          rowActions={(row) => <RowActions items={rowActions(row)} />}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('scheduler.search.placeholder', 'Search schedules...')}
          refreshButton={{
            label: t('scheduler.action.refresh', 'Refresh'),
            onRefresh: fetchSchedules,
          }}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
