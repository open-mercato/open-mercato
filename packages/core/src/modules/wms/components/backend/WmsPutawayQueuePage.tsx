"use client"

import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Package } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { E } from '#generated/entities.ids.generated'
import { extensionPoints } from '@open-mercato/core/modules/wms/extension-points'
import { flashMutationError } from '../../lib/flashMutationError'
import {
  AssignPutawayTaskDialog,
  type PutawayAssignTarget,
} from './AssignPutawayTaskDialog'
import {
  CompletePutawayTaskDialog,
  type PutawayTaskTarget,
} from './CompletePutawayTaskDialog'
import {
  canShowPutawayCompleteAction,
  formatAgingLabel,
  putawayStatusVariant,
} from './inboundStatusUi'
import { applyPutawayLockTokenFromConflict } from './putawayQueueOptimisticLock'
import { MoveInventoryDialog } from './MoveInventoryDialog'
import { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'
import {
  resolveCatalogVariantLabel,
  resolveLocationLabel,
} from './inventoryMutationLoaders'

type PutawayTaskRow = {
  id: string
  warehouse_id?: string | null
  source_location_id?: string | null
  target_location_id?: string | null
  catalog_variant_id?: string | null
  lot_id?: string | null
  quantity?: string | number | null
  status?: string | null
  assigned_to?: string | null
  priority?: number | null
  created_at?: string | null
  updated_at?: string | null
}

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function WmsPutawayQueuePage() {
  const t = useT()
  const access = useWmsInventoryMutationAccess()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-putaway-queue',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )

  const [page, setPage] = React.useState(1)
  const [statusFilter, setStatusFilter] = React.useState<'active' | 'open' | 'in_progress' | 'done' | 'cancelled' | 'all'>(
    'active',
  )
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: false }])
  const [completeOpen, setCompleteOpen] = React.useState(false)
  const [activeTask, setActiveTask] = React.useState<PutawayTaskTarget | null>(null)
  const [assignOpen, setAssignOpen] = React.useState(false)
  const [assignTask, setAssignTask] = React.useState<PutawayAssignTarget | null>(null)
  const [manualPutawayOpen, setManualPutawayOpen] = React.useState(false)
  const [labelCache, setLabelCache] = React.useState<Record<string, string>>({})
  const [nowMs, setNowMs] = React.useState(() => Date.now())
  /** Fresh If-Match tokens after 409; ref so guarded retry reads latest without re-seed. */
  const lockTokensRef = React.useRef<Record<string, string>>({})
  const [lockOverrides, setLockOverrides] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const queryKey = React.useMemo(
    () => ['wms-putaway-queue', page, statusFilter, sorting],
    [page, sorting, statusFilter],
  )

  const tasksQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const sortCol = sorting[0]
      const base = {
        page: String(page),
        pageSize: '50',
        sortField: sortCol ? sortCol.id : 'createdAt',
        sortDir: sortCol ? (sortCol.desc ? 'desc' : 'asc') : 'asc',
      }
      const load = async (status?: string) => {
        const params = new URLSearchParams(base)
        if (status) params.set('status', status)
        const call = await apiCall<PagedResponse<PutawayTaskRow>>(
          `/api/wms/putaway-tasks?${params.toString()}`,
        )
        if (!call.ok) {
          await raiseCrudError(
            call.response,
            t('wms.backend.putaway.errors.load', 'Failed to load putaway tasks.'),
          )
        }
        return call.result ?? { items: [], total: 0, totalPages: 1 }
      }

      // Active queue: single server-side multi-status page (not two truncated first pages).
      if (statusFilter === 'active') return load('open,in_progress')
      if (statusFilter === 'all') return load()
      return load(statusFilter)
    },
  })

  React.useEffect(() => {
    const ids = new Set<string>()
    for (const row of tasksQuery.data?.items ?? []) {
      if (row.catalog_variant_id) ids.add(row.catalog_variant_id)
      if (row.source_location_id) ids.add(row.source_location_id)
      if (row.target_location_id) ids.add(row.target_location_id)
    }
    const missing = [...ids].filter((id) => !labelCache[id])
    if (missing.length === 0) return
    let cancelled = false
    void Promise.all(
      missing.map(async (id) => {
        const [variant, location] = await Promise.all([
          resolveCatalogVariantLabel(id),
          resolveLocationLabel(id),
        ])
        return [id, variant || location] as const
      }),
    ).then((entries) => {
      if (cancelled) return
      setLabelCache((prev) => {
        const next = { ...prev }
        for (const [id, label] of entries) {
          if (label) next[id] = label
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [labelCache, tasksQuery.data?.items])

  const applyLockTokenFromConflict = React.useCallback(
    (taskId: string, status: number, body: unknown) => {
      const refreshed = applyPutawayLockTokenFromConflict(lockTokensRef.current, taskId, {
        status,
        body,
      })
      if (!refreshed) return
      setLockOverrides((prev) => ({ ...prev, [taskId]: refreshed }))
      queryClient.setQueriesData<PagedResponse<PutawayTaskRow>>(
        { queryKey: ['wms-putaway-queue'] },
        (previous) => {
          if (!previous?.items) return previous
          return {
            ...previous,
            items: previous.items.map((row) =>
              row.id === taskId ? { ...row, updated_at: refreshed } : row,
            ),
          }
        },
      )
    },
    [queryClient],
  )

  const postTaskAction = React.useCallback(
    async (
      taskId: string,
      action: 'assign' | 'start' | 'cancel',
      body: Record<string, unknown>,
      updatedAt?: string | null,
    ): Promise<'ok' | 'conflict'> => {
      // Seed once per user action (outside operation) so guarded retry keeps the
      // refreshed token after a 409 instead of re-binding the original row version.
      if (typeof updatedAt === 'string' && updatedAt.trim()) {
        lockTokensRef.current[taskId] = updatedAt.trim()
      }
      let conflictHandled = false
      await runMutation({
        operation: async () => {
          const call = await apiCall<{ ok?: boolean }>(
            `/api/wms/putaway-tasks/${encodeURIComponent(taskId)}/${action}`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...buildOptimisticLockHeader(lockTokensRef.current[taskId]),
              },
              body: JSON.stringify(body),
            },
          )
          if (!call.ok) {
            const refreshLockFromConflict = () => {
              applyLockTokenFromConflict(taskId, call.status, call.result)
              void queryClient.invalidateQueries({ queryKey: ['wms-putaway-queue'] })
            }
            if (
              surfaceRecordConflict({ status: call.status, body: call.result }, t, {
                onRefresh: refreshLockFromConflict,
              })
            ) {
              refreshLockFromConflict()
              conflictHandled = true
              return {}
            }
            await raiseCrudError(
              call.response,
              t('wms.backend.putaway.errors.action', 'Failed to update putaway task.'),
            )
          }
          return call.result ?? {}
        },
        context: mutationContext,
        mutationPayload: body,
      })
      if (conflictHandled) return 'conflict'
      await queryClient.invalidateQueries({ queryKey: ['wms-putaway-queue'] })
      return 'ok'
    },
    [applyLockTokenFromConflict, mutationContext, queryClient, runMutation, t],
  )

  const resolveRowUpdatedAt = React.useCallback(
    (row: PutawayTaskRow) => lockOverrides[row.id] ?? row.updated_at ?? null,
    [lockOverrides],
  )

  const handleAssignSelf = React.useCallback(
    async (row: PutawayTaskRow) => {
      if (!access.userId || !access.organizationId || !access.tenantId) return
      try {
        const result = await postTaskAction(
          row.id,
          'assign',
          {
            organizationId: access.organizationId,
            tenantId: access.tenantId,
            assignedTo: access.userId,
          },
          resolveRowUpdatedAt(row),
        )
        if (result === 'conflict') return
        flash(t('wms.backend.putaway.flash.assigned', 'Putaway task assigned'), 'success')
      } catch (error) {
        flashMutationError(error, t('wms.backend.putaway.errors.action', 'Failed to update putaway task.'), t)
      }
    },
    [access, postTaskAction, resolveRowUpdatedAt, t],
  )

  const handleStart = React.useCallback(
    async (row: PutawayTaskRow) => {
      if (!access.organizationId || !access.tenantId) return
      try {
        const result = await postTaskAction(
          row.id,
          'start',
          {
            organizationId: access.organizationId,
            tenantId: access.tenantId,
          },
          resolveRowUpdatedAt(row),
        )
        if (result === 'conflict') return
        flash(t('wms.backend.putaway.flash.started', 'Putaway task started'), 'success')
      } catch (error) {
        flashMutationError(error, t('wms.backend.putaway.errors.action', 'Failed to update putaway task.'), t)
      }
    },
    [access, postTaskAction, resolveRowUpdatedAt, t],
  )

  const handleCancel = React.useCallback(
    async (row: PutawayTaskRow) => {
      if (!access.organizationId || !access.tenantId) return
      const confirmed = await confirm({
        title: t('wms.backend.putaway.cancel.confirm.title', 'Cancel putaway task?'),
        description: t(
          'wms.backend.putaway.cancel.confirm.description',
          'The task will be cancelled and will no longer appear in the active queue.',
        ),
        confirmText: t('wms.backend.putaway.cancel.confirm.submit', 'Cancel task'),
        cancelText: t('wms.backend.putaway.cancel.confirm.keep', 'Keep task'),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        const result = await postTaskAction(
          row.id,
          'cancel',
          {
            organizationId: access.organizationId,
            tenantId: access.tenantId,
          },
          resolveRowUpdatedAt(row),
        )
        if (result === 'conflict') return
        flash(t('wms.backend.putaway.flash.cancelled', 'Putaway task cancelled'), 'success')
      } catch (error) {
        flashMutationError(error, t('wms.backend.putaway.errors.action', 'Failed to update putaway task.'), t)
      }
    },
    [access, confirm, postTaskAction, resolveRowUpdatedAt, t],
  )

  const openComplete = React.useCallback(
    (row: PutawayTaskRow) => {
      setActiveTask({
        id: row.id,
        warehouseId: row.warehouse_id ?? '',
        quantity: toNumber(row.quantity),
        targetLocationId: row.target_location_id,
        catalogVariantId: row.catalog_variant_id,
        sourceLocationId: row.source_location_id,
        updatedAt: resolveRowUpdatedAt(row),
      })
      setCompleteOpen(true)
    },
    [resolveRowUpdatedAt],
  )

  const openAssign = React.useCallback(
    (row: PutawayTaskRow) => {
      setAssignTask({
        id: row.id,
        assignedTo: row.assigned_to,
        updatedAt: resolveRowUpdatedAt(row),
      })
      setAssignOpen(true)
    },
    [resolveRowUpdatedAt],
  )

  const columns = React.useMemo<ColumnDef<PutawayTaskRow>[]>(
    () => [
      {
        id: 'status',
        accessorKey: 'status',
        header: t('wms.backend.putaway.columns.status', 'Status'),
        enableSorting: true,
        cell: ({ row }) => {
          const status = row.original.status?.trim()
          if (!status) return '—'
          return (
            <StatusBadge variant={putawayStatusVariant(status)} dot>
              {t(`wms.backend.putaway.status.${status}`, status)}
            </StatusBadge>
          )
        },
      },
      {
        id: 'variant',
        header: t('wms.backend.putaway.columns.variant', 'Variant'),
        cell: ({ row }) => {
          const id = row.original.catalog_variant_id
          if (!id) return '—'
          return labelCache[id] || id.slice(0, 8)
        },
      },
      {
        id: 'quantity',
        accessorKey: 'quantity',
        header: t('wms.backend.putaway.columns.quantity', 'Qty'),
        enableSorting: true,
        cell: ({ row }) => toNumber(row.original.quantity),
      },
      {
        id: 'source',
        header: t('wms.backend.putaway.columns.source', 'Source'),
        cell: ({ row }) => {
          const id = row.original.source_location_id
          if (!id) return '—'
          return labelCache[id] || id.slice(0, 8)
        },
      },
      {
        id: 'target',
        header: t('wms.backend.putaway.columns.target', 'Target'),
        cell: ({ row }) => {
          const id = row.original.target_location_id
          if (!id) return '—'
          return labelCache[id] || id.slice(0, 8)
        },
      },
      {
        id: 'assignee',
        header: t('wms.backend.putaway.columns.assignee', 'Assignee'),
        cell: ({ row }) => {
          const id = row.original.assigned_to
          if (!id) return t('wms.backend.putaway.assignee.unassigned', 'Unassigned')
          if (id === access.userId) return t('wms.backend.putaway.assignee.me', 'Me')
          return id.slice(0, 8)
        },
      },
      {
        id: 'aging',
        accessorKey: 'created_at',
        header: t('wms.backend.putaway.columns.aging', 'Aging'),
        enableSorting: true,
        cell: ({ row }) => formatAgingLabel(row.original.created_at, nowMs) ?? '—',
      },
    ],
    [access.userId, labelCache, nowMs, t],
  )

  const rowActions = React.useCallback(
    (row: PutawayTaskRow) => {
      const status = row.status
      if (status !== 'open' && status !== 'in_progress') return null

      const isAssignee = Boolean(access.userId && row.assigned_to === access.userId)
      const canComplete = canShowPutawayCompleteAction({
        canManagePutaway: access.canManagePutaway,
        canAdjustInventory: access.canAdjust,
        isAssignee,
      })
      if (!access.canManagePutaway && !canComplete) return null

      const items = []
      if (access.canManagePutaway) {
        items.push({
          id: 'assign',
          label: t('wms.backend.putaway.actions.assign', 'Assign…'),
          onSelect: () => openAssign(row),
        })
        if (!row.assigned_to || row.assigned_to !== access.userId) {
          items.push({
            id: 'assign-me',
            label: t('wms.backend.putaway.actions.assignMe', 'Assign to me'),
            onSelect: () => void handleAssignSelf(row),
          })
        }
        if (status === 'open') {
          items.push({
            id: 'start',
            label: t('wms.backend.putaway.actions.start', 'Start'),
            onSelect: () => void handleStart(row),
          })
        }
      }
      if (canComplete) {
        items.push({
          id: 'complete',
          label: t('wms.backend.putaway.actions.complete', 'Complete'),
          onSelect: () => openComplete(row),
        })
      }
      if (access.canManagePutaway) {
        items.push({
          id: 'cancel',
          label: t('wms.backend.putaway.actions.cancel', 'Cancel'),
          onSelect: () => void handleCancel(row),
        })
      }
      if (items.length === 0) return null
      return <RowActions items={items} />
    },
    [
      access.canAdjust,
      access.canManagePutaway,
      access.userId,
      handleAssignSelf,
      handleCancel,
      handleStart,
      openAssign,
      openComplete,
      t,
    ],
  )

  return (
    <Page>
      <PageBody className="space-y-6">
        <PageHeader
          title={t('wms.backend.putaway.title', 'Putaway queue')}
          description={t(
            'wms.backend.putaway.description',
            'Open and in-progress putaway tasks from accepted receipts.',
          )}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" asChild>
                <Link href="/backend/wms/asns">{t('wms.backend.putaway.actions.asns', 'ASNs')}</Link>
              </Button>
              {access.canMove ? (
                <Button type="button" variant="outline" onClick={() => setManualPutawayOpen(true)}>
                  <ArrowLeftRight className="size-4" />
                  {t('wms.backend.putaway.actions.manualPutaway', 'Manual put away')}
                </Button>
              ) : null}
            </div>
          }
        />

        {tasksQuery.isLoading ? (
          <LoadingMessage label={t('wms.backend.putaway.loading', 'Loading putaway tasks…')} />
        ) : null}
        {tasksQuery.isError ? (
          <ErrorMessage label={t('wms.backend.putaway.errors.load', 'Failed to load putaway tasks.')} />
        ) : null}

        {tasksQuery.data ? (
          <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-md border bg-muted/40 p-2 text-muted-foreground">
                  <Package className="size-5" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold">
                    {t('wms.backend.putaway.title', 'Putaway queue')}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      'wms.backend.putaway.description',
                      'Open and in-progress putaway tasks from accepted receipts.',
                    )}
                  </p>
                </div>
              </div>
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setPage(1)
                  setStatusFilter(value as typeof statusFilter)
                }}
              >
                <SelectTrigger className="w-[200px]" data-testid="putaway-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">
                    {t('wms.backend.putaway.filters.active', 'Open + in progress')}
                  </SelectItem>
                  <SelectItem value="open">{t('wms.backend.putaway.status.open', 'Open')}</SelectItem>
                  <SelectItem value="in_progress">
                    {t('wms.backend.putaway.status.in_progress', 'In progress')}
                  </SelectItem>
                  <SelectItem value="done">{t('wms.backend.putaway.status.done', 'Done')}</SelectItem>
                  <SelectItem value="cancelled">
                    {t('wms.backend.putaway.status.cancelled', 'Cancelled')}
                  </SelectItem>
                  <SelectItem value="all">{t('wms.backend.putaway.filters.all', 'All statuses')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DataTable
              embedded
              title={t('wms.backend.putaway.title', 'Putaway queue')}
              columns={columns}
              data={tasksQuery.data.items}
              isLoading={tasksQuery.isFetching}
              entityId={E.wms.putaway_task}
              sortable
              manualSorting
              sorting={sorting}
              onSortingChange={(next) => {
                setSorting(next)
                setPage(1)
              }}
              rowActions={rowActions}
              pagination={{
                page,
                pageSize: 50,
                total: tasksQuery.data.total,
                totalPages: tasksQuery.data.totalPages,
                onPageChange: setPage,
              }}
              perspective={{ tableId: extensionPoints.hosts.putawayTasksTable.tableId }}
              emptyState={
                <EmptyState
                  title={t('wms.backend.putaway.empty.title', 'No putaway tasks')}
                  description={t(
                    'wms.backend.putaway.empty.description',
                    'Tasks appear after ASN lines are received with QC pass.',
                  )}
                />
              }
            />
          </section>
        ) : null}
      </PageBody>

      {access.canManagePutaway ? (
        <AssignPutawayTaskDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          access={access}
          task={assignTask}
          onConflict={(taskId, status, body) => {
            applyLockTokenFromConflict(taskId, status, body)
          }}
          onSuccess={() => void tasksQuery.refetch()}
        />
      ) : null}
      {access.canAdjust ? (
        <CompletePutawayTaskDialog
          open={completeOpen}
          onOpenChange={setCompleteOpen}
          access={access}
          task={activeTask}
          onSuccess={() => void tasksQuery.refetch()}
        />
      ) : null}
      {access.canMove ? (
        <MoveInventoryDialog
          open={manualPutawayOpen}
          onOpenChange={setManualPutawayOpen}
          access={access}
          movementType="putaway"
        />
      ) : null}
      {ConfirmDialogElement}
    </Page>
  )
}
