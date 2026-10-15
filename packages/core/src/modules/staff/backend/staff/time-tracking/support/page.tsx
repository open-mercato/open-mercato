"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { TaskDrawer } from '../../../../lib/time-tracking-ui/TaskDrawer'
import { readItems, readString, readTotal, type BoardApiRow } from '../../../../lib/time-tracking-ui/kanbanBoardData'
import {
  readSupportTicket,
  SUPPORT_ACTIVITY_EVENT,
  SUPPORT_PORTAL_STATUS_VARIANT,
  type SupportTicketView,
} from '../../../../lib/time-tracking-ui/supportTicketData'
import { supportPortalStatusLabel } from '../../../../lib/time-tracking-ui/SupportRequestPanel'
import { searchCustomers } from '../../../../lib/time-tracking-ui/CustomerPicker'

const PAGE_SIZE = 25
const PROJECT_SEARCH_PAGE_SIZE = 50
const OPTIONS_URL = '/api/staff/timesheets/support-tickets/options'
const UNASSIGNED_VALUE = '__unassigned__'
const ASSIGNEE_CHANGED_EVENT = 'staff.timesheets.time_task.assignee_changed'

type SupportRow = {
  id: string
  ticket: SupportTicketView
  projectName: string | null
  assigneeName: string | null
  updatedAt: string | null
}

type Option = { value: string; label: string }

type InboxOptionsResponse = {
  categories?: Array<{ value?: unknown; label?: unknown }>
  assignees?: Array<{ id?: unknown; displayName?: unknown }>
}

function toCategoryOptions(response: InboxOptionsResponse | null | undefined): Option[] {
  return (response?.categories ?? [])
    .map((category) =>
      typeof category.value === 'string'
        ? { value: category.value, label: typeof category.label === 'string' ? category.label : category.value }
        : null,
    )
    .filter((option): option is Option => option !== null)
}

function toAssigneeOptions(response: InboxOptionsResponse | null | undefined): Option[] {
  return (response?.assignees ?? [])
    .map((assignee) =>
      typeof assignee.id === 'string'
        ? { value: assignee.id, label: typeof assignee.displayName === 'string' ? assignee.displayName : assignee.id }
        : null,
    )
    .filter((option): option is Option => option !== null)
}

function readContext(row: BoardApiRow): Record<string, unknown> | null {
  const context = (row as Record<string, unknown>)._staff
  return context && typeof context === 'object' ? (context as Record<string, unknown>) : null
}

function toSupportRow(row: BoardApiRow): SupportRow | null {
  const id = readString(row, 'id')
  const ticket = readSupportTicket(row)
  if (!id || !ticket) return null
  const context = readContext(row)
  return {
    id,
    ticket,
    projectName: typeof context?.projectName === 'string' ? context.projectName : null,
    assigneeName: typeof context?.assigneeName === 'string' ? context.assigneeName : null,
    updatedAt: readString(row, 'updated_at', 'updatedAt'),
  }
}

async function loadOptions(url: string, labelOf: (row: BoardApiRow) => string | null): Promise<Option[]> {
  const call = await apiCall<Record<string, unknown>>(url)
  if (!call.ok) return []
  return readItems(call.result)
    .map((row) => {
      const id = readString(row, 'id')
      const label = labelOf(row)
      return id && label ? { value: id, label } : null
    })
    .filter((option): option is Option => option !== null)
}

export default function SupportTicketsPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<SupportRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>(() =>
    searchParams?.get('supportUnnotified') === 'true' ? { supportUnnotified: true } : {},
  )
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [projectLabels, setProjectLabels] = React.useState<Record<string, string>>({})
  const [assigneeOptions, setAssigneeOptions] = React.useState<Option[]>([])
  const [categoryOptions, setCategoryOptions] = React.useState<Option[]>([])
  const [customerLabels, setCustomerLabels] = React.useState<Record<string, string>>({})
  const [optionsError, setOptionsError] = React.useState(false)

  const drawerTaskId = searchParams?.get('task') ?? null

  const refresh = React.useCallback(() => setRefreshKey((value) => value + 1), [])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const options = await apiCall<InboxOptionsResponse>(OPTIONS_URL)
        if (cancelled) return
        if (!options.ok) {
          setOptionsError(true)
          return
        }
        setOptionsError(false)
        setCategoryOptions(toCategoryOptions(options.result))
        setAssigneeOptions(toAssigneeOptions(options.result))
      } catch {
        if (!cancelled) setOptionsError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [scopeVersion])

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    const params = new URLSearchParams({
      source: 'portal',
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: 'updatedAt',
      sortDir: 'desc',
    })
    const portalStatus = typeof filterValues.portalStatus === 'string' ? filterValues.portalStatus : ''
    if (portalStatus) params.set('portalStatus', portalStatus)
    const category = typeof filterValues.supportCategory === 'string' ? filterValues.supportCategory : ''
    if (category) params.set('supportCategory', category)
    const projectId = typeof filterValues.timeProjectId === 'string' ? filterValues.timeProjectId : ''
    if (projectId) params.set('timeProjectId', projectId)
    const customerId = typeof filterValues.customerId === 'string' ? filterValues.customerId : ''
    if (customerId) params.set('customerId', customerId)
    const assignee = typeof filterValues.assignee === 'string' ? filterValues.assignee : ''
    if (assignee === UNASSIGNED_VALUE) params.set('unassigned', 'true')
    else if (assignee) params.set('assigneeStaffMemberId', assignee)
    if (filterValues.supportUnnotified === true || filterValues.supportUnnotified === 'true') {
      params.set('supportUnnotified', 'true')
    }
    if (search.trim()) params.set('supportReference', search.trim())
    void (async () => {
      try {
        const call = await apiCall<Record<string, unknown>>(`/api/staff/timesheets/tasks?${params.toString()}`)
        if (cancelled) return
        if (!call.ok) {
          setLoadError(true)
          return
        }
        setLoadError(false)
        setRows(readItems(call.result).map(toSupportRow).filter((row): row is SupportRow => row !== null))
        setTotal(readTotal(call.result, 0))
        setTotalIsCapped(call.result?.totalIsCapped === true)
      } catch {
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filterValues, page, refreshKey, scopeVersion, search])

  useAppEvent(SUPPORT_ACTIVITY_EVENT, () => refresh(), [refresh])
  useAppEvent(ASSIGNEE_CHANGED_EVENT, () => refresh(), [refresh])

  const openTask = React.useCallback(
    (taskId: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('task', taskId)
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const closeTask = React.useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('task')
    const query = params.toString()
    router.push(query.length > 0 ? `?${query}` : '?', { scroll: false })
  }, [router, searchParams])

  const loadCustomerOptions = React.useCallback(
    async (query?: string) => {
      const customers = await searchCustomers(query ?? '')
      setCustomerLabels((current) => ({
        ...current,
        ...Object.fromEntries(customers.map((customer) => [customer.id, customer.name])),
      }))
      return customers.map((customer) => ({
        value: customer.id,
        label: customer.name,
        description:
          customer.kind === 'company'
            ? t('staff.support.tickets.customerKind.company', 'Company')
            : t('staff.support.tickets.customerKind.person', 'Person'),
      }))
    },
    [t],
  )

  const loadProjectOptions = React.useCallback(async (query?: string) => {
    const params = new URLSearchParams({ page: '1', pageSize: String(PROJECT_SEARCH_PAGE_SIZE) })
    const trimmed = (query ?? '').trim()
    if (trimmed) params.set('q', trimmed)
    const projects = await loadOptions(`/api/staff/timesheets/time-projects?${params.toString()}`, (row) =>
      readString(row, 'name'),
    )
    setProjectLabels((current) => ({
      ...current,
      ...Object.fromEntries(projects.map((project) => [project.value, project.label])),
    }))
    return projects
  }, [])

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'portalStatus',
        label: t('staff.support.tickets.filters.portalStatus', 'Status the customer sees'),
        type: 'select',
        options: [
          { value: 'received', label: supportPortalStatusLabel(t, 'received') },
          { value: 'in_progress', label: supportPortalStatusLabel(t, 'in_progress') },
          { value: 'resolved', label: supportPortalStatusLabel(t, 'resolved') },
        ],
      },
      {
        id: 'supportCategory',
        label: t('staff.support.tickets.filters.category', 'Category'),
        type: 'select',
        options: categoryOptions,
      },
      {
        id: 'timeProjectId',
        label: t('staff.support.tickets.filters.project', 'Project'),
        type: 'combobox',
        placeholder: t('staff.support.tickets.filters.projectPlaceholder', 'Search projects'),
        loadOptions: loadProjectOptions,
        formatValue: (value: string) => projectLabels[value] ?? value,
      },
      {
        id: 'customerId',
        label: t('staff.support.tickets.filters.customer', 'Customer'),
        type: 'combobox',
        placeholder: t('staff.support.tickets.filters.customerPlaceholder', 'Search customers'),
        loadOptions: loadCustomerOptions,
        formatValue: (value: string) => customerLabels[value] ?? value,
      },
      {
        id: 'assignee',
        label: t('staff.support.tickets.filters.assignee', 'Assignee'),
        type: 'select',
        options: [{ value: UNASSIGNED_VALUE, label: t('staff.support.tickets.unassigned', 'Unassigned') }, ...assigneeOptions],
      },
      {
        id: 'supportUnnotified',
        label: t('staff.support.tickets.filters.nobodyNotified', 'Nobody notified'),
        type: 'checkbox',
      },
    ],
    [assigneeOptions, categoryOptions, customerLabels, loadCustomerOptions, loadProjectOptions, projectLabels, t],
  )

  const columns = React.useMemo<ColumnDef<SupportRow>[]>(
    () => [
      {
        accessorKey: 'reference',
        header: t('staff.support.tickets.columns.reference', 'Ticket'),
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-foreground">{row.original.ticket.supportReference}</span>
            {row.original.ticket.unnotifiedAt ? (
              <Badge variant="warning" size="sm" data-testid="support-ticket-unnotified">
                {t('staff.support.tickets.nobodyNotified', 'Nobody notified')}
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'subject',
        header: t('staff.support.tickets.columns.subject', 'Subject'),
        cell: ({ row }) => row.original.ticket.requestSubject ?? '',
      },
      {
        accessorKey: 'customer',
        header: t('staff.support.tickets.columns.customer', 'Customer'),
        cell: ({ row }) => row.original.ticket.customerName ?? '',
      },
      {
        accessorKey: 'category',
        header: t('staff.support.tickets.columns.category', 'Category'),
        cell: ({ row }) => row.original.ticket.categoryLabel,
      },
      {
        accessorKey: 'portalStatus',
        header: t('staff.support.tickets.columns.portalStatus', 'Status'),
        cell: ({ row }) => (
          <StatusBadge variant={SUPPORT_PORTAL_STATUS_VARIANT[row.original.ticket.portalStatus]} dot>
            {supportPortalStatusLabel(t, row.original.ticket.portalStatus)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'project',
        header: t('staff.support.tickets.columns.project', 'Project'),
        cell: ({ row }) => row.original.projectName ?? '',
      },
      {
        accessorKey: 'assignee',
        header: t('staff.support.tickets.columns.assignee', 'Assignee'),
        cell: ({ row }) =>
          row.original.assigneeName ?? (
            <span className="text-muted-foreground">{t('staff.support.tickets.unassigned', 'Unassigned')}</span>
          ),
      },
      {
        accessorKey: 'updatedAt',
        header: t('staff.support.tickets.columns.lastActivity', 'Last activity'),
        cell: ({ row }) => (row.original.updatedAt ? formatDateTime(row.original.updatedAt) ?? '' : ''),
      },
    ],
    [t],
  )

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Page>
      <PageBody>
        {loadError ? (
          <ErrorMessage label={t('staff.support.tickets.loadError', 'Could not load the support tickets.')} />
        ) : null}
        {optionsError ? (
          <ErrorMessage
            label={t('staff.support.tickets.optionsLoadError', 'Could not load the filter options.')}
          />
        ) : null}
        <DataTable<SupportRow>
          title={t('staff.support.tickets.title', 'Support Inbox')}
          titleHeadingLevel={1}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('staff.support.tickets.searchPlaceholder', 'Search by ticket reference')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => {
            setFilterValues(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilterValues({})
            setPage(1)
          }}
          emptyState={
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t('staff.support.tickets.empty', 'No support tickets match these filters.')}
            </div>
          }
          refreshButton={{
            label: t('staff.support.tickets.refresh', 'Refresh'),
            onRefresh: refresh,
            isRefreshing: isLoading,
          }}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            totalIsCapped,
            onPageChange: setPage,
          }}
          onRowClick={(row) => openTask(row.id)}
        />
        {drawerTaskId ? (
          <TaskDrawer
            taskId={drawerTaskId}
            open
            onOpenChange={(next) => {
              if (!next) closeTask()
            }}
            onChanged={refresh}
          />
        ) : null}
      </PageBody>
    </Page>
  )
}
