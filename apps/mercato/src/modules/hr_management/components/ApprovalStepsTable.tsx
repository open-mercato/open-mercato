"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useT, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useWorkflowOptions } from './hrOptions'

const RESOURCE = 'hr_management/approval-steps'
const CREATE_HREF = '/backend/hr/approval-steps/create'
const LIST_HREF = '/backend/hr/approval-steps'
const editHref = (id: string) => `/backend/hr/approval-steps/${id}/edit`

// Mirrors APPROVAL_APPROVER_TYPES in data/entities.ts; the API rejects an unknown value.
const APPROVER_TYPE_VALUES = ['role', 'user', 'manager'] as const

const APPROVER_TYPE_FALLBACKS: Record<(typeof APPROVER_TYPE_VALUES)[number], string> = {
  role: 'A role',
  user: 'A named user',
  manager: 'The employee’s manager',
}

export type ApprovalStepRow = {
  id: string
  workflow_id: string
  step_order: number
  name: string
  approver_type: (typeof APPROVER_TYPE_VALUES)[number]
  approver_role_id?: string | null
  approver_user_id?: string | null
  required_approvals?: number | null
  is_final?: boolean | null
  updated_at?: string | null
  updatedAt?: string | null
}

export default function ApprovalStepsTable({ workflowId }: { workflowId?: string }) {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const { workflows, labels: workflowLabels } = useWorkflowOptions()
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'stepOrder', desc: false }])
  const [page, setPage] = React.useState(1)

  // Inside a workflow the list is that workflow's steps, so the filter is the prop; on its own the
  // screen offers a workflow filter, because a step without its workflow is unreadable.
  const workflowFilter = workflowId ?? (typeof values.workflowId === 'string' ? values.workflowId : undefined)

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 100,
      sortField: sorting[0]?.id ?? 'stepOrder',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (workflowFilter) out.workflowId = workflowFilter
    return out
  }, [page, sorting, workflowFilter])

  const query = useQuery({
    queryKey: ['hr-approval-steps', params, scopeVersion],
    queryFn: () => fetchCrudList<ApprovalStepRow>(RESOURCE, params),
  })

  const data = query.data
  const rows = data?.items ?? []

  const columns = React.useMemo<ColumnDef<ApprovalStepRow>[]>(() => {
    const base: ColumnDef<ApprovalStepRow>[] = [
      {
        accessorKey: 'step_order',
        header: t('hr_management.workflowConfig.steps.columns.order', 'Order'),
        cell: ({ getValue }) => <span className="text-sm font-medium">{String(getValue() ?? '—')}</span>,
        meta: { priority: 1 },
      },
      {
        accessorKey: 'name',
        header: t('hr_management.workflowConfig.steps.columns.name', 'Step'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="text-sm">{row.original.name}</span>
            {row.original.is_final ? (
              <Badge>{t('hr_management.workflowConfig.steps.final', 'Final')}</Badge>
            ) : null}
          </div>
        ),
        meta: { priority: 1 },
      },
      {
        accessorKey: 'approver_type',
        header: t('hr_management.workflowConfig.steps.columns.approver', 'Approver'),
        cell: ({ row }) => (
          <span className="text-sm">
            {t(`hr_management.workflowConfig.approverTypes.${row.original.approver_type}`, APPROVER_TYPE_FALLBACKS[row.original.approver_type])}
          </span>
        ),
        meta: { priority: 2 },
      },
      {
        accessorKey: 'required_approvals',
        header: t('hr_management.workflowConfig.steps.columns.required', 'Approvals needed'),
        cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? 1)}</span>,
        meta: { priority: 3 },
      },
    ]
    if (workflowId) return base
    // Column shown only across workflows: inside one it would repeat the same value on every row.
    return [
      {
        accessorKey: 'workflow_id',
        header: t('hr_management.workflowConfig.steps.columns.workflow', 'Workflow'),
        cell: ({ row }) => (
          <span className="text-sm">{workflowLabels.get(row.original.workflow_id) ?? '—'}</span>
        ),
        meta: { priority: 1 },
      },
      ...base,
    ]
  }, [t, workflowId, workflowLabels])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('hr_management.workflowConfig.steps.error.load', 'Could not load approval steps.')}</div>
  }

  return (
    <DataTable
      title={workflowId
        ? t('hr_management.workflowConfig.steps.page.title', 'Approval steps')
        : t('hr_management.workflowConfig.steps.page.allTitle', 'Approval steps (all workflows)')}
      titleHeadingLevel={workflowId ? 2 : 1}
      actions={(
        <Button asChild>
          <Link href={workflowId ? `${CREATE_HREF}?workflowId=${encodeURIComponent(workflowId)}` : CREATE_HREF}>
            {t('hr_management.workflowConfig.steps.actions.create', 'New step')}
          </Link>
        </Button>
      )}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('hr_management.workflowConfig.steps.actions.edit', 'Edit')}
        </Link>
      )}
      columns={columns}
      data={rows}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={workflowId
        ? []
        : [{
            id: 'workflowId',
            label: t('hr_management.workflowConfig.steps.filters.workflow', 'Workflow'),
            type: 'select',
            options: workflows.map((workflow) => ({ value: workflow.id, label: workflow.name })),
          }]}
      filterValues={values}
      onFiltersApply={(next: FilterValues) => {
        setValues(next)
        setPage(1)
      }}
      onFiltersClear={() => {
        setValues({})
        setPage(1)
      }}
      entityId="hr_management:hr_approval_step_definition"
      sortable
      sorting={sorting}
      onSortingChange={(next) => {
        setSorting(next)
        setPage(1)
      }}
      pagination={{
        page,
        pageSize: 100,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
        totalIsCapped: data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={query.isLoading}
    />
  )
}
