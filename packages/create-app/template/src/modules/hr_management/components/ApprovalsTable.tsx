"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useT, useLocale, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

// `import type` only: a value import of the entities module would pull MikroORM decorators
// into the browser bundle.
import type { ApprovalRequestStatus } from '../data/entities'
import {
  describeStepProgress,
  findCurrentStep,
  isAwaitingActor,
  pendingAgeInDays,
  resolveApprovalTarget,
  type ApprovalStepRow,
} from '../lib/approvalInbox'
import { ApprovalDecisionDialog, type ApprovalDecisionAction } from './ApprovalDecisionDialog'
import { ApprovalHistoryDialog } from './ApprovalHistoryDialog'
import { useHrUserLabels } from './userOptions'

const RESOURCE = 'hr_management/approval-requests'
const MUTATION_CONTEXT_ID = 'hr-approvals-inbox:mutation'
// The command guard compares this against the header the client sends; the value only has to be
// stable and match the command, since the default lock mode covers every resource kind.
const RESOURCE_KIND = 'hr_management:hr_approval_request'

const STATUS_VALUES: ApprovalRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled']

const STATUS_MAP: StatusMap<ApprovalRequestStatus> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  cancelled: 'neutral',
}

const STATUS_FALLBACKS: Record<ApprovalRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

const ENTITY_TYPE_VALUES = ['hr_leave_request', 'hr_attendance_record'] as const

const ENTITY_TYPE_FALLBACKS: Record<string, string> = {
  hr_leave_request: 'Leave request',
  hr_attendance_record: 'Attendance record',
}

export type ApprovalRequestRow = {
  id: string
  workflow_id: string
  entity_type: string
  entity_id: string
  status: ApprovalRequestStatus
  current_step_order: number
  requested_by_user_id?: string | null
  decided_at?: string | null
  summary?: string | null
  created_at?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

type WorkflowRow = { id: string; name: string }

type PendingDecision = {
  row: ApprovalRequestRow
  action: ApprovalDecisionAction
}

/**
 * The approvals queue.
 *
 * Pending requests are the default view because the queue exists to be emptied; anything already
 * decided is one filter click away rather than mixed into the work. The step column names the
 * workflow's current step and flags the steps that name the signed-in user, but it deliberately
 * neither reorders nor hides the rest: role and manager steps are resolved by the engine at
 * decision time, so an "awaiting me only" list would hide requests an operator here can decide.
 */
export default function ApprovalsTable() {
  const t = useT()
  const locale = useLocale()
  const direction = useDirection()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const currentUserId = useCurrentUserId()

  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({ status: 'pending' })
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'created_at', desc: true }])
  const [page, setPage] = React.useState(1)
  const [decision, setDecision] = React.useState<PendingDecision | null>(null)
  const [pending, setPending] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [historyFor, setHistoryFor] = React.useState<ApprovalRequestRow | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const statusFilter = typeof values.status === 'string' ? values.status : undefined
  const entityTypeFilter = typeof values.entityType === 'string' ? values.entityType : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'created_at',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (statusFilter) out.status = statusFilter
    if (entityTypeFilter) out.entityType = entityTypeFilter
    // Sent to the server rather than filtering the current page, so the box can find a request that
    // is not on screen yet.
    if (search.trim().length > 0) out.search = search.trim()
    return out
  }, [page, sorting, statusFilter, entityTypeFilter, search])

  const requests = useQuery({
    queryKey: ['hr-approvals', params, scopeVersion],
    queryFn: () => fetchCrudList<ApprovalRequestRow>(RESOURCE, params),
  })

  const workflows = useQuery({
    queryKey: ['hr-approval-workflows', scopeVersion],
    queryFn: () => fetchCrudList<WorkflowRow>('hr_management/approval-workflows', { pageSize: 100 }),
    staleTime: 5 * 60 * 1000,
  })

  const steps = useQuery({
    queryKey: ['hr-approval-steps', scopeVersion],
    queryFn: () => fetchCrudList<ApprovalStepRow>('hr_management/approval-steps', { pageSize: 100 }),
    staleTime: 5 * 60 * 1000,
  })

  const items = requests.data?.items ?? []

  const workflowNames = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const workflow of workflows.data?.items ?? []) map.set(workflow.id, workflow.name)
    return map
  }, [workflows.data])

  const stepsByWorkflow = React.useMemo(() => {
    const map = new Map<string, ApprovalStepRow[]>()
    for (const step of steps.data?.items ?? []) {
      const bucket = map.get(step.workflow_id)
      if (bucket) bucket.push(step)
      else map.set(step.workflow_id, [step])
    }
    return map
  }, [steps.data])

  const userLabels = useHrUserLabels(items.map((row) => row.requested_by_user_id ?? ''))

  const requesterLabel = React.useCallback(
    (userId: string | null | undefined) => {
      if (!userId) return t('hr_management.approvals.requesterUnknown', 'Unknown')
      return userLabels.get(userId) ?? userId
    },
    [t, userLabels],
  )

  const confirmDecision = React.useCallback(
    async ({ comment, approverUserId }: { comment: string; approverUserId?: string }) => {
      if (!decision) return
      const { row, action } = decision
      setPending(true)
      setActionError(null)
      try {
        await runMutation({
          operation: async () => {
            const call = await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(row.updatedAt ?? row.updated_at ?? null),
              () => apiCall(`/api/hr_management/approvals/${action}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  id: row.id,
                  ...(comment.length > 0 ? { comment } : {}),
                  ...(approverUserId ? { approverUserId } : {}),
                }),
              }),
            )
            if (!call.ok) {
              const body = (call.result ?? {}) as Record<string, unknown>
              // The engine translates its own refusals (`hr_management.errors.*`), so the server
              // message is already user-facing; the `[internal]` text is only the fallback.
              const serverMessage = typeof body.error === 'string' && body.error.trim().length > 0 ? body.error : null
              throw Object.assign(new Error(serverMessage ?? '[internal] hr approvals decision failed'), {
                status: call.status,
                ...body,
              })
            }
            return call
          },
          context: {
            formId: MUTATION_CONTEXT_ID,
            resourceKind: RESOURCE_KIND,
            resourceId: row.id,
            retryLastMutation,
          },
          mutationPayload: { id: row.id, action },
        })
        setDecision(null)
        await queryClient.invalidateQueries({ queryKey: ['hr-approvals'] })
      } catch (caught: unknown) {
        if (surfaceRecordConflict(caught, t, {
          onRefresh: () => { void queryClient.invalidateQueries({ queryKey: ['hr-approvals'] }) },
        })) {
          setDecision(null)
          return
        }
        // A refusal that is not a version conflict still means the row on screen is stale — the
        // likeliest cause is another approver deciding it first — so the list refreshes anyway.
        void queryClient.invalidateQueries({ queryKey: ['hr-approvals'] })
        setActionError(caught instanceof Error && caught.message
          ? caught.message
          : t('hr_management.approvals.error.decide', 'Could not record the decision.'))
      } finally {
        setPending(false)
      }
    },
    [decision, queryClient, retryLastMutation, runMutation, t],
  )

  const decisionTarget = decision
    ? resolveApprovalTarget(decision.row.entity_type, decision.row.entity_id)?.label
      ?? t(`hr_management.approvals.targets.${decision.row.entity_type}`, decision.row.entity_type)
    : null

  const decisionStep = React.useMemo(() => {
    if (!decision) return null
    const current = findCurrentStep(
      stepsByWorkflow.get(decision.row.workflow_id) ?? [],
      decision.row.current_step_order,
    )
    return current?.name ?? null
  }, [decision, stepsByWorkflow])

  const columns = React.useMemo<ColumnDef<ApprovalRequestRow>[]>(() => [
    {
      id: 'entity_type',
      accessorFn: (row) => row.entity_type,
      header: t('hr_management.approvals.columns.request', 'Request'),
      cell: ({ row }) => {
        const target = resolveApprovalTarget(row.original.entity_type, row.original.entity_id)
        const label = target
          ? t(target.labelKey, target.label)
          : t(
              `hr_management.approvals.targets.${row.original.entity_type}`,
              ENTITY_TYPE_FALLBACKS[row.original.entity_type] ?? row.original.entity_type,
            )
        return (
          <div className="flex flex-col gap-0.5">
            {target ? (
              <Link className="text-sm font-medium underline" href={target.href}>{label}</Link>
            ) : (
              <span className="text-sm font-medium">{label}</span>
            )}
            {row.original.summary && row.original.summary.trim().length > 0 ? (
              <span className="text-xs text-muted-foreground">{row.original.summary}</span>
            ) : null}
          </div>
        )
      },
      meta: { priority: 1 },
    },
    {
      id: 'workflow_id',
      accessorFn: (row) => row.workflow_id,
      header: t('hr_management.approvals.columns.workflow', 'Workflow'),
      cell: ({ row }) => workflowNames.get(row.original.workflow_id) ?? '—',
    },
    {
      id: 'current_step_order',
      accessorFn: (row) => row.current_step_order,
      header: t('hr_management.approvals.columns.step', 'Step'),
      cell: ({ row }) => {
        const workflowSteps = stepsByWorkflow.get(row.original.workflow_id) ?? []
        const progress = describeStepProgress(workflowSteps, row.original.current_step_order)
        const current = findCurrentStep(workflowSteps, row.original.current_step_order)
        const awaitingMe = isAwaitingActor(current, currentUserId)
        const isPending = row.original.status === 'pending'
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">
              {t('hr_management.approvals.stepOf', 'Step {index} of {total}', {
                index: String(progress.index),
                total: String(progress.total),
              })}
              {current?.name ? ` · ${current.name}` : ''}
            </span>
            {awaitingMe && isPending ? (
              <StatusBadge variant="info" dot>{t('hr_management.approvals.awaitingYou', 'Awaiting you')}</StatusBadge>
            ) : null}
            {progress.isFinalStep && isPending ? (
              <span className="text-xs text-muted-foreground">
                {t('hr_management.approvals.finalStep', 'Completes the request')}
              </span>
            ) : null}
          </div>
        )
      },
      meta: { priority: 3 },
    },
    {
      id: 'requested_by_user_id',
      accessorFn: (row) => row.requested_by_user_id ?? '',
      header: t('hr_management.approvals.columns.requester', 'Requested by'),
      cell: ({ row }) => (
        <span className="text-sm">{requesterLabel(row.original.requested_by_user_id)}</span>
      ),
      meta: { priority: 4 },
    },
    {
      id: 'created_at',
      accessorFn: (row) => row.created_at ?? '',
      // The unit lives in the header, not in the cell: the i18n layer has no plural forms, so a
      // count-dependent noun would be wrong in Arabic for most numbers ("3 أيام" vs "11 يومًا").
      header: t('hr_management.approvals.columns.waiting', 'Waiting (days)'),
      cell: ({ row }) => {
        const age = pendingAgeInDays(row.original.created_at, row.original.status)
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">{formatDate(row.original.created_at, locale) ?? '—'}</span>
            {age !== null ? (
              <span className="text-xs text-muted-foreground">{String(age)}</span>
            ) : null}
          </div>
        )
      },
      meta: { priority: 5 },
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t('hr_management.approvals.columns.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_MAP[row.original.status] ?? 'neutral'} dot>
          {t(`hr_management.approvals.status.${row.original.status}`, STATUS_FALLBACKS[row.original.status])}
        </StatusBadge>
      ),
      meta: { priority: 2 },
    },
  ], [t, locale, currentUserId, requesterLabel, stepsByWorkflow, workflowNames])

  if (requests.isError) {
    return <div className="text-sm text-destructive">{t('hr_management.approvals.error.load', 'Could not load approval requests.')}</div>
  }

  return (
    <>
      {actionError ? <p className="mb-2 text-sm text-destructive">{actionError}</p> : null}
      <DataTable
        title={t('hr_management.approvals.page.title', 'Approvals')}
        titleHeadingLevel={1}
        columns={columns}
        data={items}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchAlign={direction === 'rtl' ? 'left' : 'right'}
        filters={[
          {
            id: 'status',
            label: t('hr_management.approvals.filters.status', 'Status'),
            type: 'select',
            options: STATUS_VALUES.map((value) => ({
              value,
              label: t(`hr_management.approvals.status.${value}`, STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'entityType',
            label: t('hr_management.approvals.filters.entityType', 'Request type'),
            type: 'select',
            options: ENTITY_TYPE_VALUES.map((value) => ({
              value,
              label: t(`hr_management.approvals.targets.${value}`, ENTITY_TYPE_FALLBACKS[value]),
            })),
          },
        ]}
        filterValues={values}
        onFiltersApply={(next: FilterValues) => {
          setValues(next)
          setPage(1)
        }}
        onFiltersClear={() => {
          // Clearing the filters means "show me the whole history", not "show me nothing".
          setValues({})
          setPage(1)
        }}
        rowActions={(row) => {
          const isPending = row.status === 'pending'
          return (
            <div className="flex flex-wrap items-center gap-2">
              {isPending ? (
                <>
                  <Button type="button" size="sm" onClick={() => setDecision({ row, action: 'approve' })}>
                    {t('hr_management.approvals.actions.approve', 'Approve')}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setDecision({ row, action: 'reject' })}>
                    {t('hr_management.approvals.actions.reject', 'Reject')}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setDecision({ row, action: 'reassign' })}>
                    {t('hr_management.approvals.actions.reassign', 'Reassign')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDecision({ row, action: 'cancel' })}>
                    {t('hr_management.approvals.actions.cancel', 'Cancel request')}
                  </Button>
                </>
              ) : null}
              <Button type="button" size="sm" variant="ghost" onClick={() => setHistoryFor(row)}>
                {t('hr_management.approvals.actions.history', 'History')}
              </Button>
            </div>
          )
        }}
        entityId="hr_management:hr_approval_request"
        sortable
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next)
          setPage(1)
        }}
        pagination={{
          page,
          pageSize: 50,
          total: requests.data?.total ?? 0,
          totalPages: requests.data?.totalPages ?? 0,
          totalIsCapped: requests.data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        isLoading={requests.isLoading}
      />

      <ApprovalDecisionDialog
        action={decision?.action ?? null}
        targetLabel={decisionTarget}
        stepLabel={decisionStep}
        pending={pending}
        onOpenChange={(open) => {
          if (!open) setDecision(null)
        }}
        onConfirm={confirmDecision}
      />

      <ApprovalHistoryDialog
        approvalRequestId={historyFor?.id ?? null}
        summary={historyFor?.summary ?? null}
        open={historyFor !== null}
        onOpenChange={(open) => {
          if (!open) setHistoryFor(null)
        }}
      />
    </>
  )
}
