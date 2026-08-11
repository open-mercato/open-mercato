"use client"

/**
 * Work Inbox (spec §6.2) — one queue over every registered source.
 *
 * Replaces the User Tasks list, which is now a bridge redirect onto this page.
 * Two things about it are load-bearing:
 *
 * - **`perspective.tableId` stays `workflows.tasks.list`.** That id is FROZEN
 *   (BACKWARD_COMPATIBILITY.md §6): the enterprise agent_orchestrator injects
 *   its "Review proposal" row action into
 *   `data-table:workflows.tasks.list:row-actions`, which `DataTable` resolves
 *   from this exact prop. Renaming it would make that action silently vanish.
 *   The action reads `row.proposalId`, which the work-inbox row still carries
 *   because a `user_task` row is a superset of the task row it replaced.
 * - **Status is never colour-only.** Every badge pairs a design-system status
 *   token with its own icon and its translated label
 *   (`lib/work-inbox/presentation.ts`). The retired list used `bg-yellow-100` /
 *   `bg-blue-100` / `bg-green-100` and `text-red-600`, none of which survive
 *   dark mode or a colour-blind reader.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { WORK_INBOX_PRIORITIES } from '../../lib/work-inbox/provider'
import type { WorkInboxWireRow } from '../../lib/work-inbox/provider'
import { buildWorkInboxListQueryParams } from '../../lib/work-inbox/query'
import { buildWorkInboxItemHref } from '../../lib/work-inbox/navigation'
import { resolveWorkInboxEmptyState } from '../../lib/work-inbox/empty-state'
import {
  WORK_INBOX_OVERDUE_TONE,
  describeWorkInboxPriority,
  describeWorkInboxStatus,
} from '../../lib/work-inbox/presentation'
import { StatusChip } from '../../components/work-inbox/StatusChip'
import { WorkInboxEmptyState } from '../../components/work-inbox/WorkInboxEmptyState'
import { extensionPoints } from '@open-mercato/core/modules/workflows/extension-points'

/**
 * `data-table:workflows.tasks.list:*` is a FROZEN widget spot id — the
 * enterprise Caseload row action is wired to it. Never rename this.
 *
 * Read from the extension-point catalogue rather than re-typed here: this page
 * is the declared host, so the literal and the declaration cannot drift apart,
 * and the module-facts extractor can bind the declaration to its host.
 */
const WORK_INBOX_TABLE_ID = extensionPoints.hosts.tasksTable.tableId

const PAGE_SIZE = 50

type WorkInboxResponse = {
  data: WorkInboxWireRow[]
  pagination: { total: number; limit: number; offset: number; hasMore: boolean }
  meta: { kinds: string[]; degradedKinds: string[] }
  /**
   * Present only for a `workflows.tasks.view_all` holder or a superadmin. It is
   * what turns "the page is shorter than the total and nobody says why" into
   * "one row is here, you just cannot see its record" (design §3.6).
   */
  diagnostics?: { entityHiddenCount: number }
}

export default function WorkInboxPage() {
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [availableKinds, setAvailableKinds] = React.useState<string[]>([])
  const [entityHiddenCount, setEntityHiddenCount] = React.useState(0)
  const [degradedKinds, setDegradedKinds] = React.useState<string[]>([])
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({ myWork: 'true' })

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-work-inbox', 'list', filterValues, page],
    queryFn: async () => {
      const params = buildWorkInboxListQueryParams(filterValues, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })

      const result = await apiCall<WorkInboxResponse>(`/api/workflows/work-inbox?${params.toString()}`)
      if (!result.ok) {
        throw new Error('[internal] work inbox request failed')
      }

      const response = result.result
      if (response?.pagination) {
        setTotal(response.pagination.total || 0)
        setTotalPages(Math.ceil((response.pagination.total || 0) / PAGE_SIZE) || 1)
      }
      setEntityHiddenCount(response?.diagnostics?.entityHiddenCount ?? 0)
      if (response?.meta) {
        setAvailableKinds(response.meta.kinds ?? [])
        const degraded = response.meta.degradedKinds ?? []
        setDegradedKinds(degraded)
        if (degraded.length > 0) {
          flash(t('workflows.workInbox.messages.degraded'), 'error')
        }
      } else {
        setDegradedKinds([])
      }

      return response?.data ?? []
    },
  })

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['workflow-work-inbox'] })
  }, [queryClient])

  const handleClaim = React.useCallback(
    async (row: WorkInboxWireRow) => {
      const confirmed = await confirmDialog({
        title: t('workflows.tasks.confirm.claim', { name: row.title }),
        variant: 'default',
      })
      if (!confirmed) return

      const result = await apiCall(`/api/workflows/tasks/${row.id}/claim`, { method: 'POST' })
      if (result.ok) {
        flash(t('workflows.tasks.messages.claimed'), 'success')
        invalidate()
      } else {
        flash(t('workflows.tasks.messages.claimFailed'), 'error')
      }
    },
    [confirmDialog, invalidate, t],
  )

  const handleRelease = React.useCallback(
    async (row: WorkInboxWireRow) => {
      const confirmed = await confirmDialog({
        title: t('workflows.workInbox.confirm.unclaim', { name: row.title }),
        variant: 'default',
      })
      if (!confirmed) return

      const result = await apiCall(`/api/workflows/tasks/${row.id}/unclaim`, { method: 'POST' })
      if (result.ok) {
        flash(t('workflows.workInbox.messages.released'), 'success')
        invalidate()
      } else {
        flash(t('workflows.workInbox.messages.releaseFailed'), 'error')
      }
    },
    [confirmDialog, invalidate, t],
  )

  const handleClaimNext = React.useCallback(async () => {
    const result = await apiCall<{ data: WorkInboxWireRow | null }>(
      '/api/workflows/work-inbox/next',
      { method: 'POST' },
    )
    if (!result.ok) {
      flash(t('workflows.tasks.messages.claimFailed'), 'error')
      return
    }
    const claimed = result.result?.data ?? null
    if (!claimed) {
      flash(t('workflows.workInbox.messages.nothingClaimable'), 'info')
      return
    }
    flash(t('workflows.tasks.messages.claimed'), 'success')
    invalidate()
    router.push(buildWorkInboxItemHref(claimed.id))
  }, [invalidate, router, t])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const next: FilterValues = {}
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== '') next[key] = value
    })
    setFilterValues(next)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({ myWork: 'true' })
    setPage(1)
  }, [])

  const filters: FilterDef[] = React.useMemo(
    () => [
      {
        id: 'myWork',
        type: 'select',
        label: t('workflows.tasks.filters.view'),
        options: [
          { label: t('workflows.workInbox.filters.myWork'), value: 'true' },
          { label: t('workflows.workInbox.filters.allWork'), value: '' },
        ],
      },
      {
        id: 'kind',
        type: 'select',
        label: t('workflows.workInbox.filters.kind'),
        options: [
          { label: t('common.all'), value: '' },
          ...availableKinds.map((kind) => ({
            label: t(`workflows.workInbox.kinds.${kind}`, kind),
            value: kind,
          })),
        ],
      },
      {
        id: 'priority',
        type: 'select',
        label: t('workflows.workInbox.filters.priority'),
        options: [
          { label: t('common.all'), value: '' },
          ...WORK_INBOX_PRIORITIES.map((priority) => ({
            label: t(`workflows.workInbox.priorities.${priority}`),
            value: priority,
          })),
        ],
      },
      {
        id: 'status',
        type: 'select',
        label: t('workflows.tasks.filters.status'),
        options: [
          { label: t('common.all'), value: '' },
          { label: t('workflows.tasks.statuses.PENDING'), value: 'PENDING' },
          { label: t('workflows.tasks.statuses.IN_PROGRESS'), value: 'IN_PROGRESS' },
          { label: t('workflows.tasks.statuses.COMPLETED'), value: 'COMPLETED' },
          { label: t('workflows.tasks.statuses.CANCELLED'), value: 'CANCELLED' },
          { label: t('workflows.tasks.statuses.ESCALATED'), value: 'ESCALATED' },
        ],
      },
      {
        id: 'overdue',
        type: 'select',
        label: t('workflows.tasks.filters.overdue'),
        options: [
          { label: t('common.all'), value: '' },
          { label: t('workflows.tasks.filters.overdueOnly'), value: 'true' },
        ],
      },
      {
        id: 'module',
        type: 'text',
        label: t('workflows.workInbox.filters.module'),
        placeholder: t('workflows.workInbox.filters.modulePlaceholder'),
      },
      {
        id: 'entityType',
        type: 'text',
        label: t('workflows.workInbox.filters.entityType'),
        placeholder: t('workflows.workInbox.filters.entityTypePlaceholder'),
      },
      {
        id: 'role',
        type: 'text',
        label: t('workflows.workInbox.filters.role'),
        placeholder: t('workflows.workInbox.filters.rolePlaceholder'),
      },
    ],
    [availableKinds, t],
  )

  const columns: ColumnDef<WorkInboxWireRow>[] = React.useMemo(
    () => [
      {
        id: 'title',
        header: t('workflows.workInbox.fields.item'),
        accessorKey: 'title',
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-sm">{row.original.title}</div>
            {row.original.description ? (
              <div className="text-xs text-muted-foreground line-clamp-1">{row.original.description}</div>
            ) : null}
            {row.original.entityBindings.length > 0 ? (
              <div className="text-xs text-muted-foreground">
                {row.original.entityBindings
                  .map((binding) => binding.label || `${binding.entityType} ${binding.entityId}`)
                  .join(', ')}
              </div>
            ) : null}
            {row.original.overdue ? (
              <div className="mt-1">
                <StatusChip
                  descriptor={WORK_INBOX_OVERDUE_TONE}
                  label={t('workflows.tasks.overdue')}
                />
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'kind',
        header: t('workflows.workInbox.fields.kind'),
        accessorKey: 'kind',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {t(`workflows.workInbox.kinds.${row.original.kind}`, row.original.kind)}
          </span>
        ),
      },
      {
        id: 'priority',
        header: t('workflows.workInbox.fields.priority'),
        accessorKey: 'priority',
        cell: ({ row }) => {
          const descriptor = describeWorkInboxPriority(row.original.priority)
          if (!descriptor) {
            return <span className="text-sm text-muted-foreground">{t('workflows.workInbox.priorities.unset')}</span>
          }
          return (
            <StatusChip
              descriptor={descriptor}
              label={t(`workflows.workInbox.priorities.${row.original.priority}`)}
            />
          )
        },
      },
      {
        id: 'status',
        header: t('workflows.tasks.fields.status'),
        accessorKey: 'status',
        cell: ({ row }) => {
          const descriptor = describeWorkInboxStatus(row.original.status)
          return (
            <StatusChip
              descriptor={descriptor}
              label={t(`workflows.tasks.statuses.${row.original.status}`, row.original.status)}
            />
          )
        },
      },
      {
        id: 'assignment',
        header: t('workflows.tasks.fields.assignment'),
        cell: ({ row }) => {
          if (row.original.claimedBy) {
            return (
              <div className="text-sm text-foreground">
                {t('workflows.tasks.claimedBy')}: {row.original.claimedBy}
              </div>
            )
          }
          if (row.original.assignedTo) {
            return <div className="text-sm text-foreground">{row.original.assignedTo}</div>
          }
          if (row.original.assignedToRoles && row.original.assignedToRoles.length > 0) {
            return (
              <div className="text-sm text-muted-foreground">
                {t('workflows.tasks.roles')}: {row.original.assignedToRoles.join(', ')}
              </div>
            )
          }
          return <span className="text-sm text-muted-foreground">-</span>
        },
      },
      {
        id: 'dueDate',
        header: t('workflows.tasks.fields.dueDate'),
        accessorKey: 'dueDate',
        cell: ({ row }) => {
          if (!row.original.dueDate) {
            return <span className="text-sm text-muted-foreground">-</span>
          }
          const tone = row.original.overdue ? WORK_INBOX_OVERDUE_TONE.text : 'text-foreground'
          return (
            <div className={`text-sm ${tone}`}>{new Date(row.original.dueDate).toLocaleString()}</div>
          )
        },
      },
      {
        id: 'createdAt',
        header: t('workflows.tasks.fields.createdAt'),
        accessorKey: 'createdAt',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {new Date(row.original.createdAt).toLocaleString()}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const item = row.original
          const items: Array<{ id: string; label: string; href?: string; onSelect?: () => void }> = []

          if (item.detailHref) {
            items.push({
              id: 'view',
              label: t('workflows.tasks.actions.viewDetails'),
              href: item.detailHref,
            })
          }

          const claimable =
            item.status === 'PENDING' &&
            !item.assignedTo &&
            !item.claimedBy &&
            (item.assignedToRoles?.length ?? 0) > 0

          if (claimable) {
            items.push({
              id: 'claim',
              label: t('workflows.tasks.actions.claim'),
              onSelect: () => void handleClaim(item),
            })
          }

          if (item.status === 'IN_PROGRESS' && item.claimedBy) {
            items.push({
              id: 'unclaim',
              label: t('workflows.tasks.actions.unclaim'),
              onSelect: () => void handleRelease(item),
            })
          }

          if (item.detailHref && (item.status === 'PENDING' || item.status === 'IN_PROGRESS')) {
            items.push({
              id: 'complete',
              label: t('workflows.tasks.actions.complete'),
              href: item.detailHref,
            })
          }

          return <RowActions items={items} />
        },
      },
    ],
    [handleClaim, handleRelease, t],
  )

  const rows = data ?? []

  // §6.4 turned an empty inbox from "there is no work" into a statement about
  // this account's relationship to the work. Which statement it is belongs to a
  // PURE resolver, never to this file.
  const emptyState = React.useMemo(
    () => resolveWorkInboxEmptyState({ filterValues, entityHiddenCount, degradedKinds }),
    [degradedKinds, entityHiddenCount, filterValues],
  )

  return (
    <Page>
      <PageBody>
        {/*
          The banner explains a page that is SHORTER than its total. With no rows
          at all the empty state says the same thing in the place the reader is
          already looking, so showing both would be one message twice.
        */}
        {entityHiddenCount > 0 && rows.length > 0 ? (
          <Alert status="information" className="mb-4">
            {t('workflows.workInbox.messages.entityHidden', { count: entityHiddenCount })}
          </Alert>
        ) : null}
        <DataTable
          title={t('workflows.workInbox.list.title')}
          columns={columns}
          data={rows}
          isLoading={isLoading}
          error={error ? t('workflows.workInbox.messages.loadFailed') : null}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          emptyState={
            emptyState.kind === 'filtered' ? undefined : <WorkInboxEmptyState state={emptyState} />
          }
          // The narrowed case is handed to the shared `FilteredEmptyResults`,
          // which already owns that copy and the clear-filters affordance.
          filterAwareEmptyState={{
            active: emptyState.kind === 'filtered',
            entityNamePlural: t('workflows.workInbox.empty.entityNamePlural'),
            canRemoveLast: false,
            onClearAll: handleFiltersClear,
            onRemoveLast: handleFiltersClear,
          }}
          actions={
            <Button onClick={() => void handleClaimNext()}>
              {t('workflows.workInbox.actions.claimNext')}
            </Button>
          }
          perspective={{ tableId: WORK_INBOX_TABLE_ID }}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
