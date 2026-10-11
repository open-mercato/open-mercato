'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { InstanceStatusBadge } from '../../../components/run/RunStatusBadge'
import { useLiveRunUpdates } from '../../../components/run/useLiveRunUpdates'
import { formatElapsedSince } from '../../../lib/run-duration'
import type { FailureGroup } from '../../../lib/failure-grouping'

const PAGE_SIZE = 50

type FailureQueueRow = {
  id: string
  workflowId: string
  version: number
  status: string
  currentStepId: string | null
  errorMessage: string | null
  retryCount: number
  startedAt: string
  completedAt: string | null
  metadata?: { attention?: { reason?: string; stepId?: string; at?: string } | null } | null
}

type FailureQueueResponse = {
  data: FailureQueueRow[]
  groups: FailureGroup[]
  grouping: { scannedCount: number; scanLimit: number; truncated: boolean }
  pagination: { total: number; limit: number; offset: number; hasMore: boolean; totalIsCapped?: boolean }
}

type BulkReplayResponse = {
  ok: boolean
  progressJobId: string | null
  message: string
}

/**
 * Failure-queue triage (spec §8.4).
 *
 * The list is the union of instances parked by a `failureQueue` error directive
 * and FAILED instances. Error grouping is what makes it a triage surface rather
 * than a second instance list: 400 rows collapse into the handful of things
 * that actually broke, and selecting a group narrows the table to it so a bulk
 * replay targets one root cause instead of everything at once.
 */
export default function WorkflowFailureQueuePage() {
  const t = useT()
  const queryClient = useQueryClient()
  const { payload } = useBackendChrome()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [page, setPage] = React.useState(1)
  const [errorGroup, setErrorGroup] = React.useState<string | null>(null)

  const canBulkOperate = hasFeature(payload?.grantedFeatures, 'workflows.instances.bulk_ops')

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-failure-queue', errorGroup, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      })
      if (errorGroup) params.set('errorGroup', errorGroup)
      const result = await apiCall<FailureQueueResponse>(
        `/api/workflows/instances/failure-queue?${params.toString()}`
      )
      if (!result.ok) throw new Error('[internal] Failed to load the workflow failure queue')
      return result.result ?? null
    },
  })

  const refreshQueue = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['workflow-failure-queue'] })
  }, [queryClient])

  useLiveRunUpdates({ onRefresh: refreshQueue })

  const runBulkReplay = React.useCallback(
    async (action: 'retry' | 'cancel', rows: FailureQueueRow[]) => {
      const confirmed = await confirmDialog({
        title:
          action === 'retry'
            ? t('workflows.failureQueue.confirm.retry', 'Replay {count} instance(s)?', {
                count: String(rows.length),
              })
            : t('workflows.failureQueue.confirm.cancel', 'Cancel {count} instance(s)?', {
                count: String(rows.length),
              }),
        variant: action === 'cancel' ? 'destructive' : 'default',
      })
      if (!confirmed) return false

      const result = await apiCall<BulkReplayResponse>('/api/workflows/instances/bulk-replay', {
        method: 'POST',
        body: JSON.stringify({ action, ids: rows.map((row) => row.id) }),
      })

      if (!result.ok || !result.result?.ok) {
        return {
          ok: false,
          message: t('workflows.failureQueue.messages.bulkFailed', 'Could not start the bulk operation.'),
        }
      }

      // The DataTable tracks the returned job in the top bar; never add a
      // page-local progress bar for bulk work.
      return {
        ok: true,
        progressJobId: result.result.progressJobId,
        message:
          action === 'retry'
            ? t('workflows.failureQueue.messages.retryStarted', 'Replay started. Track progress in the top bar.')
            : t('workflows.failureQueue.messages.cancelStarted', 'Cancellation started. Track progress in the top bar.'),
      }
    },
    [confirmDialog, t]
  )

  const columns = React.useMemo<ColumnDef<FailureQueueRow>[]>(
    () => [
      {
        id: 'workflowId',
        header: t('workflows.instances.fields.workflowId'),
        accessorKey: 'workflowId',
        cell: ({ row }) => (
          <Link href={`/backend/instances/${row.original.id}`} className="block hover:underline">
            <div className="font-mono text-sm font-medium">{row.original.workflowId}</div>
            <div className="text-xs text-muted-foreground">#{row.original.id.slice(0, 8)}</div>
          </Link>
        ),
      },
      {
        id: 'status',
        header: t('workflows.instances.fields.status'),
        accessorKey: 'status',
        cell: ({ row }) => <InstanceStatusBadge status={row.original.status} />,
      },
      {
        id: 'reason',
        header: t('workflows.failureQueue.columns.reason', 'Reason'),
        meta: { truncate: true, maxWidth: 420 },
        cell: ({ row }) => {
          const attention = row.original.metadata?.attention
          const message = row.original.errorMessage ?? attention?.reason ?? null
          return (
            <div className="text-sm">
              <div className="text-foreground">
                {message ?? t('workflows.failureQueue.noReason', 'No error message recorded')}
              </div>
              {attention?.stepId ? (
                <div className="font-mono text-xs text-muted-foreground">{attention.stepId}</div>
              ) : null}
            </div>
          )
        },
      },
      {
        id: 'retryCount',
        header: t('workflows.instances.fields.retryCount'),
        accessorKey: 'retryCount',
        cell: ({ row }) => (
          <span
            className={`text-sm ${
              row.original.retryCount > 0 ? 'font-medium text-status-warning-text' : 'text-muted-foreground'
            }`}
          >
            {row.original.retryCount}
          </span>
        ),
      },
      {
        id: 'age',
        header: t('workflows.failureQueue.columns.age', 'Age'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatElapsedSince(row.original.startedAt, row.original.completedAt) ?? '-'}
          </span>
        ),
      },
    ],
    [t]
  )

  const groups = data?.groups ?? []
  const activeGroup = groups.find((group) => group.key === errorGroup) ?? null

  if (error) {
    return (
      <Page>
        <PageBody>
          <div className="p-8 text-center">
            <p className="text-status-error-text">
              {t('workflows.failureQueue.messages.loadFailed', 'Failed to load the failure queue.')}
            </p>
            <Button onClick={refreshQueue} className="mt-4">
              {t('common.retry')}
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4 md:p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t('workflows.failureQueue.groups.title', 'Grouped by error')}
            </h2>
            {groups.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('workflows.failureQueue.groups.empty', 'Nothing is waiting for triage.')}
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {groups.map((group) => {
                  const selected = group.key === errorGroup
                  return (
                    <Button
                      key={group.key}
                      type="button"
                      size="sm"
                      variant={selected ? 'default' : 'outline'}
                      onClick={() => {
                        setErrorGroup(selected ? null : group.key)
                        setPage(1)
                      }}
                      aria-pressed={selected}
                      title={group.label}
                      className="max-w-full justify-start"
                    >
                      <span className="truncate">{group.label}</span>
                      <span className="ml-2 shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">
                        {group.count}
                      </span>
                    </Button>
                  )
                })}
              </div>
            )}
            {data?.grouping.truncated ? (
              <p className="mt-3 text-xs text-status-warning-text">
                {t(
                  'workflows.failureQueue.groups.truncated',
                  'Grouped from the {count} most recent failures. Narrow by workflow to group the rest.',
                  { count: String(data.grouping.scanLimit) }
                )}
              </p>
            ) : null}
            {activeGroup ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {t('workflows.failureQueue.groups.active', 'Showing {count} instance(s) in this group.', {
                  count: String(activeGroup.count),
                })}
              </p>
            ) : null}
          </div>

          <DataTable<FailureQueueRow>
            title={t('workflows.failureQueue.title', 'Failure queue')}
            columns={columns}
            data={data?.data ?? []}
            isLoading={isLoading}
            selectionScopeKey={errorGroup ?? 'all'}
            refreshButton={{ label: t('common.refresh', 'Refresh'), onRefresh: refreshQueue }}
            pagination={{
              page,
              pageSize: PAGE_SIZE,
              total: data?.pagination.total ?? 0,
              totalPages: Math.max(Math.ceil((data?.pagination.total ?? 0) / PAGE_SIZE), 1),
              totalIsCapped: data?.pagination.totalIsCapped === true,
              onPageChange: setPage,
            }}
            emptyState={t('workflows.failureQueue.empty', 'Nothing is waiting for triage.')}
            bulkActions={
              canBulkOperate
                ? [
                    {
                      id: 'bulk-retry',
                      label: t('workflows.failureQueue.actions.retry', 'Replay selected'),
                      onExecute: (rows) => runBulkReplay('retry', rows),
                    },
                    {
                      id: 'bulk-cancel',
                      label: t('workflows.failureQueue.actions.cancel', 'Cancel selected'),
                      destructive: true,
                      onExecute: (rows) => runBulkReplay('cancel', rows),
                    },
                  ]
                : undefined
            }
          />
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
