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
import { HR_APPROVAL_TARGETS, resolveApprovalTargetLabel } from '../lib/approvalTargets'

const RESOURCE = 'hr_management/approval-workflows'
const CREATE_HREF = '/backend/hr/approval-workflows/create'
const editHref = (id: string) => `/backend/hr/approval-workflows/${id}/edit`
const stepsHref = (workflowId: string) => `/backend/hr/approval-steps?workflowId=${encodeURIComponent(workflowId)}`

export type ApprovalWorkflowRow = {
  id: string
  name: string
  code: string
  entity_type: string
  description?: string | null
  is_active?: boolean | null
  updated_at?: string | null
  updatedAt?: string | null
}

export default function ApprovalWorkflowsTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [page, setPage] = React.useState(1)

  const entityTypeFilter = typeof values.entityType === 'string' ? values.entityType : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'name',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (entityTypeFilter) out.entityType = entityTypeFilter
    return out
  }, [page, sorting, entityTypeFilter])

  const query = useQuery({
    queryKey: ['hr-approval-workflows', params, scopeVersion],
    queryFn: () => fetchCrudList<ApprovalWorkflowRow>(RESOURCE, params),
  })

  const data = query.data
  const rows = data?.items ?? []

  const columns = React.useMemo<ColumnDef<ApprovalWorkflowRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('hr_management.workflowConfig.columns.name', 'Workflow'),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{row.original.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>
        </div>
      ),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'entity_type',
      header: t('hr_management.workflowConfig.columns.entityType', 'Applies to'),
      cell: ({ row }) => <span className="text-sm">{resolveApprovalTargetLabel(row.original.entity_type, t)}</span>,
      meta: { priority: 1 },
    },
    {
      id: 'isActive',
      header: t('hr_management.workflowConfig.columns.isActive', 'State'),
      cell: ({ row }) => (
        <Badge>
          {row.original.is_active === false
            ? t('hr_management.workflowConfig.state.inactive', 'Inactive')
            : t('hr_management.workflowConfig.state.active', 'Active')}
        </Badge>
      ),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'description',
      header: t('hr_management.workflowConfig.columns.description', 'Description'),
      cell: ({ row }) => {
        const value = row.original.description
        return value && value.length > 0
          ? <span className="text-sm text-muted-foreground">{value}</span>
          : <span className="text-xs text-muted-foreground">—</span>
      },
      meta: { priority: 3 },
    },
  ], [t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('hr_management.workflowConfig.error.load', 'Could not load approval workflows.')}</div>
  }

  return (
    <DataTable
      title={t('hr_management.workflowConfig.page.title', 'Approval workflows')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('hr_management.workflowConfig.actions.create', 'New workflow')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <span className="flex items-center gap-3">
          {/* Steps are configured per workflow, so the row leads to them rather than to a global list. */}
          <Link className="text-sm font-medium underline" href={stepsHref(row.id)}>
            {t('hr_management.workflowConfig.actions.steps', 'Steps')}
          </Link>
          <Link className="text-sm font-medium underline" href={editHref(row.id)}>
            {t('hr_management.workflowConfig.actions.edit', 'Edit')}
          </Link>
        </span>
      )}
      columns={columns}
      data={rows}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'entityType',
          label: t('hr_management.workflowConfig.filters.entityType', 'Applies to'),
          type: 'select',
          options: HR_APPROVAL_TARGETS.map((target) => ({
            value: target.value,
            label: t(target.labelKey, target.fallbackLabel),
          })),
        },
      ]}
      filterValues={values}
      onFiltersApply={(next: FilterValues) => {
        setValues(next)
        setPage(1)
      }}
      onFiltersClear={() => {
        setValues({})
        setPage(1)
      }}
      entityId="hr_management:hr_approval_workflow"
      sortable
      sorting={sorting}
      onSortingChange={(next) => {
        setSorting(next)
        setPage(1)
      }}
      pagination={{
        page,
        pageSize: 50,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
        totalIsCapped: data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={query.isLoading}
    />
  )
}
