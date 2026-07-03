"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ClaimStatusBadge, type ClaimStatus } from './components/ClaimStatusBadge'

type ClaimType = 'warranty' | 'return' | 'core_return' | 'vendor_recovery'
type ClaimPriority = 'low' | 'normal' | 'high' | 'urgent'

type ClaimRow = {
  id: string
  claimNumber: string | null
  claimType: ClaimType | string | null
  status: ClaimStatus | string | null
  priority: ClaimPriority | string | null
  customerName: string | null
  orderId: string | null
  slaDueAt: string | null
  assigneeUserId: string | null
  updatedAt: string | null
}

type ClaimsResponse = {
  items?: ClaimRow[]
  total?: number
  totalPages?: number
  page?: number
  pageSize?: number
  error?: string
}

type AssignFormValues = {
  assigneeUserId?: string | null
}

const CLAIM_STATUSES: ClaimStatus[] = [
  'draft',
  'submitted',
  'in_review',
  'info_requested',
  'approved',
  'awaiting_return',
  'received',
  'inspecting',
  'resolved',
  'rejected',
  'closed',
  'cancelled',
]

const CLAIM_TYPES: ClaimType[] = ['warranty', 'return', 'core_return', 'vendor_recovery']
const CLAIM_PRIORITIES: ClaimPriority[] = ['low', 'normal', 'high', 'urgent']
const TERMINAL_STATUSES = new Set<string>(['closed', 'cancelled'])
const CANCEL_BLOCKED_STATUSES = new Set<string>(['received', 'inspecting', 'resolved', 'closed', 'cancelled'])
const PAGE_SIZE = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value : null
}

function normalizeClaimRow(value: unknown): ClaimRow | null {
  if (!isRecord(value)) return null
  const id = toStringOrNull(value.id)
  if (!id) return null
  return {
    id,
    claimNumber: toStringOrNull(value.claimNumber),
    claimType: toStringOrNull(value.claimType),
    status: toStringOrNull(value.status),
    priority: toStringOrNull(value.priority),
    customerName: toStringOrNull(value.customerName),
    orderId: toStringOrNull(value.orderId),
    slaDueAt: toStringOrNull(value.slaDueAt),
    assigneeUserId: toStringOrNull(value.assigneeUserId),
    updatedAt: toStringOrNull(value.updatedAt),
  }
}

function shortId(value: string | null): string {
  if (!value) return ''
  return value.length > 8 ? value.slice(0, 8) : value
}

function relativeTime(value: string | null, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const diffMs = date.getTime() - Date.now()
  const absMs = Math.abs(diffMs)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ]
  const [unit, unitMs] = units.find(([, size]) => absMs >= size) ?? ['minute', 60_000]
  const amount = Math.round(diffMs / unitMs)
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit)
}

function formatDateTime(value: string | null, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function valueAsStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function buildConflictError(call: { status: number; result: unknown }, fallbackMessage: string): Error & Record<string, unknown> {
  const payload = isRecord(call.result) ? call.result : {}
  const message = typeof payload.error === 'string' ? payload.error : fallbackMessage
  return Object.assign(new Error(message), { status: call.status }, payload)
}

export default function WarrantyClaimsPage() {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<ClaimRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState(searchParams.get('search') ?? '')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'slaDueAt', desc: false }])
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [assignTarget, setAssignTarget] = React.useState<ClaimRow | null>(null)

  const mutationContextId = 'warranty-claims-list'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    setSearch(searchParams.get('search') ?? '')
  }, [searchParams])

  const updateSearchParam = React.useCallback((value: string) => {
    const next = new URLSearchParams(searchParams.toString())
    const trimmed = value.trim()
    if (trimmed) next.set('search', trimmed)
    else next.delete('search')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }, [pathname, router, searchParams])

  const queryString = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    if (search.trim()) params.set('search', search.trim())
    const statuses = valueAsStringArray(filterValues.status)
    if (statuses.length) params.set('status', statuses.join(','))
    const claimType = toStringOrNull(filterValues.claimType)
    if (claimType) params.set('claimType', claimType)
    const priority = toStringOrNull(filterValues.priority)
    if (priority) params.set('priority', priority)
    if (filterValues.overdueOnly === true) params.set('overdueOnly', 'true')
    const primarySort = sorting[0]
    if (primarySort) {
      params.set('sortField', primarySort.id)
      params.set('sortDir', primarySort.desc ? 'desc' : 'asc')
    }
    return params.toString()
  }, [filterValues, page, search, sorting])

  const reload = React.useCallback(() => {
    setReloadToken((current) => current + 1)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function loadClaims() {
      setLoading(true)
      try {
        const fallback: ClaimsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<ClaimsResponse>(`/api/warranty_claims?${queryString}`, undefined, { fallback })
        if (!call.ok) {
          const message = call.result?.error ?? t('warranty_claims.list.error.load')
          flash(message, 'error')
          return
        }
        if (cancelled) return
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        setRows(items.map(normalizeClaimRow).filter((row): row is ClaimRow => row !== null))
        setTotal(typeof call.result?.total === 'number' ? call.result.total : items.length)
        setTotalPages(typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : t('warranty_claims.list.error.load')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadClaims()
    return () => {
      cancelled = true
    }
  }, [queryString, reloadToken, scopeVersion, t])

  const statusOptions = React.useMemo(
    () => CLAIM_STATUSES.map((status) => ({ value: status, label: t(`warranty_claims.status.${status}`) })),
    [t],
  )
  const claimTypeOptions = React.useMemo(
    () => CLAIM_TYPES.map((claimType) => ({ value: claimType, label: t(`warranty_claims.claimType.${claimType}`) })),
    [t],
  )
  const priorityOptions = React.useMemo(
    () => CLAIM_PRIORITIES.map((priority) => ({ value: priority, label: t(`warranty_claims.priority.${priority}`) })),
    [t],
  )

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('warranty_claims.list.filter.status'),
      type: 'select',
      multiple: true,
      options: statusOptions,
    },
    {
      id: 'claimType',
      label: t('warranty_claims.list.filter.claimType'),
      type: 'select',
      options: claimTypeOptions,
    },
    {
      id: 'priority',
      label: t('warranty_claims.list.filter.priority'),
      type: 'select',
      options: priorityOptions,
    },
    {
      id: 'overdueOnly',
      label: t('warranty_claims.list.filter.overdueOnly'),
      type: 'checkbox',
    },
  ], [claimTypeOptions, priorityOptions, statusOptions, t])

  const runClaimAction = React.useCallback(async (
    claim: ClaimRow,
    actionId: string,
    endpoint: string,
    body: Record<string, unknown>,
    successKey: string,
  ) => {
    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(claim.updatedAt),
            () => apiCall(endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
          )
          if (!call.ok) {
            const error = buildConflictError(call, t('warranty_claims.detail.error.action'))
            if (surfaceRecordConflict(error, t, { onRefresh: reload })) return call
            throw error
          }
          return call
        },
        mutationPayload: { action: actionId, ...body },
        context: {
          formId: mutationContextId,
          resourceKind: 'warranty_claims.claim',
          resourceId: claim.id,
          retryLastMutation,
        },
      })
      flash(t(successKey), 'success')
      reload()
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: reload })) return
      const message = error instanceof Error ? error.message : t('warranty_claims.list.error.action')
      flash(message, 'error')
    }
  }, [mutationContextId, reload, retryLastMutation, runMutation, t])

  const handleCancel = React.useCallback(async (claim: ClaimRow) => {
    const confirmed = await confirm({
      title: t('warranty_claims.detail.confirm.cancelTitle'),
      variant: 'destructive',
    })
    if (!confirmed) return
    await runClaimAction(
      claim,
      'cancel',
      '/api/warranty_claims/transition',
      { id: claim.id, toStatus: 'cancelled' },
      'warranty_claims.list.flash.cancelled',
    )
  }, [confirm, runClaimAction, t])

  const assignFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'assigneeUserId',
      label: t('warranty_claims.form.assigneeUserId'),
      type: 'text',
      placeholder: t('warranty_claims.form.assigneeUserId.placeholder'),
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<ClaimRow>[]>(() => {
    const noValue = <span className="text-sm text-muted-foreground">{t('warranty_claims.common.noValue')}</span>
    return [
      {
        accessorKey: 'claimNumber',
        header: t('warranty_claims.list.column.claimNumber'),
        meta: { alwaysVisible: true, maxWidth: '180px' },
        cell: ({ row }) => (
          <Link href={`/backend/warranty_claims/${row.original.id}`} className="font-medium hover:underline">
            {row.original.claimNumber ?? row.original.id}
          </Link>
        ),
      },
      {
        accessorKey: 'claimType',
        header: t('warranty_claims.list.column.claimType'),
        cell: ({ row }) => {
          const value = row.original.claimType
          return value ? (
            <StatusBadge variant="neutral">{t(`warranty_claims.claimType.${value}`)}</StatusBadge>
          ) : noValue
        },
      },
      {
        accessorKey: 'status',
        header: t('warranty_claims.list.column.status'),
        cell: ({ row }) => <ClaimStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'priority',
        header: t('warranty_claims.list.column.priority'),
        cell: ({ row }) => {
          const value = row.original.priority
          return value ? <span className="text-sm">{t(`warranty_claims.priority.${value}`)}</span> : noValue
        },
      },
      {
        accessorKey: 'customerName',
        header: t('warranty_claims.list.column.customer'),
        cell: ({ row }) => row.original.customerName ? <span>{row.original.customerName}</span> : noValue,
      },
      {
        accessorKey: 'orderId',
        header: t('warranty_claims.list.column.order'),
        cell: ({ row }) => row.original.orderId ? <span className="font-mono text-xs">{shortId(row.original.orderId)}</span> : noValue,
      },
      {
        accessorKey: 'slaDueAt',
        header: t('warranty_claims.list.column.slaDueAt'),
        cell: ({ row }) => {
          const value = row.original.slaDueAt
          const isOverdue =
            value !== null &&
            new Date(value).getTime() < Date.now() &&
            !TERMINAL_STATUSES.has(String(row.original.status ?? ''))
          return (
            <span className={isOverdue ? 'text-sm font-medium text-status-error-text' : 'text-sm text-muted-foreground'}>
              {relativeTime(value, t('warranty_claims.common.noValue'))}
            </span>
          )
        },
      },
      {
        accessorKey: 'assigneeUserId',
        header: t('warranty_claims.list.column.assignee'),
        cell: ({ row }) => row.original.assigneeUserId ? <span className="font-mono text-xs">{shortId(row.original.assigneeUserId)}</span> : noValue,
      },
      {
        accessorKey: 'updatedAt',
        header: t('warranty_claims.list.column.updatedAt'),
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDateTime(row.original.updatedAt, t('warranty_claims.common.noValue'))}</span>,
      },
    ]
  }, [t])

  return (
    <Page>
      <PageBody>
        <DataTable<ClaimRow>
          stickyFirstColumn
          stickyActionsColumn
          title={t('warranty_claims.list.title')}
          refreshButton={{
            label: t('warranty_claims.list.actions.refresh'),
            onRefresh: reload,
            isRefreshing: loading,
          }}
          actions={(
            <Button asChild>
              <Link href="/backend/warranty_claims/create">
                {t('warranty_claims.list.actions.new')}
              </Link>
            </Button>
          )}
          columns={columns}
          columnChooser={{ auto: true }}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
            updateSearchParam(value)
          }}
          searchPlaceholder={t('warranty_claims.list.searchPlaceholder')}
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
          perspective={{ tableId: 'warranty_claims.claims.list' }}
          onRowClick={(row) => router.push(`/backend/warranty_claims/${row.id}`)}
          sortable
          manualSorting
          sorting={sorting}
          onSortingChange={setSorting}
          isLoading={loading}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'open',
                  label: t('warranty_claims.list.actions.open'),
                  onSelect: () => router.push(`/backend/warranty_claims/${row.id}`),
                },
                {
                  id: 'assign',
                  label: t('warranty_claims.list.actions.assign'),
                  onSelect: () => setAssignTarget(row),
                },
                ...CANCEL_BLOCKED_STATUSES.has(String(row.status ?? ''))
                  ? []
                  : [{
                    id: 'cancel',
                    label: t('warranty_claims.list.actions.cancel'),
                    destructive: true,
                    onSelect: () => {
                      void handleCancel(row)
                    },
                  }],
              ]}
            />
          )}
          emptyState={(
            <ListEmptyState
              title={t('warranty_claims.list.empty.title')}
              description={t('warranty_claims.list.empty.description')}
              createHref="/backend/warranty_claims/create"
              createLabel={t('warranty_claims.list.actions.new')}
            />
          )}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
        />
      </PageBody>
      <Dialog open={assignTarget !== null} onOpenChange={(open) => { if (!open) setAssignTarget(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('warranty_claims.detail.actions.assign')}</DialogTitle>
          </DialogHeader>
          <CrudForm<AssignFormValues>
            embedded
            title={t('warranty_claims.detail.actions.assign')}
            fields={assignFields}
            initialValues={{ assigneeUserId: assignTarget?.assigneeUserId ?? '' }}
            submitLabel={t('warranty_claims.form.submit')}
            onSubmit={async (values) => {
              if (!assignTarget) return
              const assigneeUserId = values.assigneeUserId?.trim() || null
              await runClaimAction(
                assignTarget,
                'assign',
                '/api/warranty_claims/assign',
                { id: assignTarget.id, assigneeUserId },
                'warranty_claims.list.flash.assigned',
              )
              setAssignTarget(null)
            }}
          />
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </Page>
  )
}
