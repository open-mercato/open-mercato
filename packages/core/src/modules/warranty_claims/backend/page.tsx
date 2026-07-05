"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type BulkAction } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import {
  fetchAssignableStaffMembersPage,
  type AssignableStaffMember,
} from '@open-mercato/core/modules/customers/components/detail/assignableStaff'
import {
  ClaimPriorityBadge,
  ClaimStatusBadge,
  CLAIM_STATUS_BADGE_VARIANTS,
  type ClaimPriority,
  type ClaimStatus,
} from './components/ClaimStatusBadge'
import { ClaimSlaIndicator } from './components/claimSla'
import { ClaimsKpiStrip, type WarrantyClaimsStats } from './components/ClaimsKpiStrip'

type ClaimType = 'warranty' | 'return' | 'core_return' | 'vendor_recovery'
type ClaimChannel = 'staff' | 'portal' | 'api'

type ClaimRow = {
  id: string
  claimNumber: string | null
  claimType: ClaimType | string | null
  channel: ClaimChannel | string | null
  status: ClaimStatus | string | null
  priority: ClaimPriority | string | null
  customerName: string | null
  orderId: string | null
  slaDueAt: string | null
  slaPausedAt: string | null
  submittedAt: string | null
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

type ClaimsStatsResponse = {
  ok?: boolean
  result?: WarrantyClaimsStats
  error?: string
}

type SearchParamsLike = {
  toString: () => string
}

type RestoredClaimListState = {
  page: number
  search: string
  filterValues: FilterValues
  sorting: SortingState
}

type AssignDialogState = {
  mode: 'single' | 'bulk'
  rows: ClaimRow[]
  resolve?: (result: false | { ok: true; affectedCount?: number }) => void
} | null

type BulkFailure = {
  message: string
}

const CLAIM_STATUSES = Object.keys(CLAIM_STATUS_BADGE_VARIANTS) as ClaimStatus[]
const CLAIM_TYPES: ClaimType[] = ['warranty', 'return', 'core_return', 'vendor_recovery']
const CLAIM_CHANNELS = ['staff', 'portal', 'api'] as const
const CLAIM_PRIORITIES: ClaimPriority[] = ['low', 'normal', 'high', 'urgent']
const CANCEL_BLOCKED_STATUSES = new Set<string>(['received', 'inspecting', 'resolved', 'closed', 'cancelled'])
const PAGE_SIZE = 20
const UNASSIGNED_ASSIGNEE_VALUE = '__unassigned__'
const DEFAULT_SORTING: SortingState = [{ id: 'slaDueAt', desc: false }]
const SORTABLE_FIELDS = new Set(['slaDueAt', 'createdAt', 'updatedAt'])
const STATUS_GROUPS: Array<{ id: string; labelKey: string; fallback: string; statuses: ClaimStatus[] }> = [
  { id: 'submitted', labelKey: 'warranty_claims.list.quickFilters.submitted', fallback: 'Submitted', statuses: ['submitted'] },
  { id: 'in_review', labelKey: 'warranty_claims.list.quickFilters.inReview', fallback: 'In review', statuses: ['in_review'] },
  { id: 'info_requested', labelKey: 'warranty_claims.list.quickFilters.infoRequested', fallback: 'Info requested', statuses: ['info_requested'] },
  {
    id: 'approved_goods_flow',
    labelKey: 'warranty_claims.list.quickFilters.approvedGoodsFlow',
    fallback: 'Approved + goods flow',
    statuses: ['approved', 'awaiting_return', 'received', 'inspecting'],
  },
]

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
    channel: toStringOrNull(value.channel),
    status: toStringOrNull(value.status),
    priority: toStringOrNull(value.priority),
    customerName: toStringOrNull(value.customerName),
    orderId: toStringOrNull(value.orderId),
    slaDueAt: toStringOrNull(value.slaDueAt),
    slaPausedAt: toStringOrNull(value.slaPausedAt),
    submittedAt: toStringOrNull(value.submittedAt),
    assigneeUserId: toStringOrNull(value.assigneeUserId),
    updatedAt: toStringOrNull(value.updatedAt),
  }
}

function normalizeClaimChannel(value: string | null | undefined): ClaimChannel | null {
  return value === 'staff' || value === 'portal' || value === 'api' ? value : null
}

function shortId(value: string | null): string {
  if (!value) return ''
  return value.length > 8 ? value.slice(0, 8) : value
}

function valueAsStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function defaultSortingState(): SortingState {
  return DEFAULT_SORTING.map((entry) => ({ ...entry }))
}

function isOneOf<T extends string>(value: string | null, values: readonly T[]): value is T {
  return value !== null && (values as readonly string[]).includes(value)
}

function parseClaimListUrlState(searchParams: SearchParamsLike): RestoredClaimListState {
  const params = new URLSearchParams(searchParams.toString())
  const parsedPage = Number(params.get('page') ?? '1')
  const filterValues: FilterValues = {}
  const statuses = (params.get('status') ?? '')
    .split(',')
    .map((status) => status.trim())
    .filter((status): status is ClaimStatus => isOneOf(status, CLAIM_STATUSES))
  if (statuses.length) filterValues.status = statuses
  const claimType = params.get('claimType')
  if (isOneOf(claimType, CLAIM_TYPES)) filterValues.claimType = claimType
  const priority = params.get('priority')
  if (isOneOf(priority, CLAIM_PRIORITIES)) filterValues.priority = priority
  const channel = params.get('channel')
  if (isOneOf(channel, CLAIM_CHANNELS)) filterValues.channel = channel
  const assigneeUserId = toStringOrNull(params.get('assigneeUserId'))
  if (assigneeUserId) filterValues.assigneeUserId = assigneeUserId
  if (params.get('overdueOnly') === 'true') filterValues.overdueOnly = true
  const sortField = params.get('sortField')
  const sorting = sortField && SORTABLE_FIELDS.has(sortField)
    ? [{ id: sortField, desc: params.get('sortDir') === 'desc' }]
    : defaultSortingState()
  return {
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? Math.trunc(parsedPage) : 1,
    search: params.get('search') ?? '',
    filterValues,
    sorting,
  }
}

function appendClaimListFilterParams(params: URLSearchParams, filterValues: FilterValues): void {
  const statuses = valueAsStringArray(filterValues.status)
  if (statuses.length) params.set('status', statuses.join(','))
  const claimType = toStringOrNull(filterValues.claimType)
  if (claimType) params.set('claimType', claimType)
  const priority = toStringOrNull(filterValues.priority)
  if (priority) params.set('priority', priority)
  const channel = toStringOrNull(filterValues.channel)
  if (channel) params.set('channel', channel)
  const assigneeUserId = toStringOrNull(filterValues.assigneeUserId)
  if (assigneeUserId) params.set('assigneeUserId', assigneeUserId)
  if (filterValues.overdueOnly === true) params.set('overdueOnly', 'true')
}

function appendClaimListSortParams(params: URLSearchParams, sorting: SortingState): void {
  const primarySort = sorting[0]
  if (!primarySort || !SORTABLE_FIELDS.has(primarySort.id)) return
  params.set('sortField', primarySort.id)
  params.set('sortDir', primarySort.desc ? 'desc' : 'asc')
}

function buildClaimListUrlQuery(page: number, search: string, filterValues: FilterValues, sorting: SortingState): string {
  const params = new URLSearchParams()
  if (search.trim()) params.set('search', search.trim())
  if (page > 1) params.set('page', String(page))
  appendClaimListFilterParams(params, filterValues)
  appendClaimListSortParams(params, sorting)
  return params.toString()
}

function buildClaimListApiQuery(page: number, search: string, filterValues: FilterValues, sorting: SortingState): string {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('pageSize', String(PAGE_SIZE))
  if (search.trim()) params.set('search', search.trim())
  appendClaimListFilterParams(params, filterValues)
  appendClaimListSortParams(params, sorting)
  return params.toString()
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const leftSet = new Set(left)
  return right.every((value) => leftSet.has(value))
}

function staffOptionLabel(member: AssignableStaffMember): string {
  return member.email && member.email !== member.displayName
    ? `${member.displayName} (${member.email})`
    : member.displayName
}

function normalizeAssigneeValue(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized || normalized === UNASSIGNED_ASSIGNEE_VALUE) return null
  return normalized
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
  const currentUserId = useCurrentUserId()
  const initialUrlStateRef = React.useRef<RestoredClaimListState | null>(null)
  if (initialUrlStateRef.current === null) {
    initialUrlStateRef.current = parseClaimListUrlState(searchParams)
  }
  const initialUrlState = initialUrlStateRef.current
  const [rows, setRows] = React.useState<ClaimRow[]>([])
  const [page, setPage] = React.useState(initialUrlState.page)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState(initialUrlState.search)
  const [filterValues, setFilterValues] = React.useState<FilterValues>(initialUrlState.filterValues)
  const [sorting, setSorting] = React.useState<SortingState>(initialUrlState.sorting)
  const [loading, setLoading] = React.useState(true)
  const [stats, setStats] = React.useState<WarrantyClaimsStats | null>(null)
  const [statsLoading, setStatsLoading] = React.useState(true)
  const [statsError, setStatsError] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [assignDialog, setAssignDialog] = React.useState<AssignDialogState>(null)
  const urlQueryRef = React.useRef(searchParams.toString())

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
    const current = searchParams.toString()
    if (urlQueryRef.current === current) return
    urlQueryRef.current = current
    const restored = parseClaimListUrlState(searchParams)
    setPage(restored.page)
    setSearch(restored.search)
    setFilterValues(restored.filterValues)
    setSorting(restored.sorting)
  }, [searchParams])

  React.useEffect(() => {
    if (!pathname) return
    const next = buildClaimListUrlQuery(page, search, filterValues, sorting)
    if (urlQueryRef.current === next) return
    urlQueryRef.current = next
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
  }, [filterValues, page, pathname, router, search, sorting])

  const queryString = React.useMemo(() => {
    return buildClaimListApiQuery(page, search, filterValues, sorting)
  }, [filterValues, page, search, sorting])

  const reload = React.useCallback(() => {
    setReloadToken((current) => current + 1)
  }, [])

  useAppEvent('warranty_claims.claim.*', () => {
    reload()
  }, [reload])

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

  React.useEffect(() => {
    const controller = new AbortController()
    setStatsLoading(true)
    setStatsError(false)
    readApiResultOrThrow<ClaimsStatsResponse>(
      '/api/warranty_claims/stats',
      { signal: controller.signal },
      { errorMessage: t('warranty_claims.list.error.load') },
    )
      .then((payload) => {
        if (controller.signal.aborted) return
        if (payload?.ok === true && payload.result) {
          setStats(payload.result)
          setStatsError(false)
        } else {
          setStats(null)
          setStatsError(true)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStats(null)
          setStatsError(true)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatsLoading(false)
      })
    return () => controller.abort()
  }, [reloadToken, scopeVersion, t])

  const statusOptions = React.useMemo(
    () => CLAIM_STATUSES.map((status) => ({ value: status, label: t(`warranty_claims.status.${status}`) })),
    [t],
  )
  const channelOptions = React.useMemo(
    () => CLAIM_CHANNELS.map((channel) => ({ value: channel, label: t(`warranty_claims.channel.${channel}`) })),
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
      id: 'channel',
      label: t('warranty_claims.list.filter.channel'),
      type: 'select',
      options: channelOptions,
    },
    {
      id: 'overdueOnly',
      label: t('warranty_claims.list.filter.overdueOnly'),
      type: 'checkbox',
    },
  ], [channelOptions, claimTypeOptions, priorityOptions, statusOptions, t])

  const loadAssignableStaffOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    const page = await fetchAssignableStaffMembersPage(query ?? '', { pageSize: 24 })
    const options = page.items.map((member) => ({
      value: member.userId,
      label: staffOptionLabel(member),
    }))
    return [
      {
        value: UNASSIGNED_ASSIGNEE_VALUE,
        label: t('warranty_claims.form.assigneeUserId.unassigned', 'Unassigned'),
      },
      ...options,
    ]
  }, [t])

  const assignSeedOptions = React.useMemo<CrudFieldOption[]>(() => {
    const options = new Map<string, CrudFieldOption>()
    options.set(UNASSIGNED_ASSIGNEE_VALUE, {
      value: UNASSIGNED_ASSIGNEE_VALUE,
      label: t('warranty_claims.form.assigneeUserId.unassigned', 'Unassigned'),
    })
    for (const row of assignDialog?.rows ?? []) {
      if (!row.assigneeUserId || options.has(row.assigneeUserId)) continue
      options.set(row.assigneeUserId, {
        value: row.assigneeUserId,
        label: row.assigneeUserId,
      })
    }
    return Array.from(options.values())
  }, [assignDialog?.rows, t])

  const executeClaimAction = React.useCallback(async (
    claim: ClaimRow,
    actionId: string,
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<unknown> => {
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
      return null
    } catch (error) {
      return error
    }
  }, [mutationContextId, retryLastMutation, runMutation, t])

  const runClaimAction = React.useCallback(async (
    claim: ClaimRow,
    actionId: string,
    endpoint: string,
    body: Record<string, unknown>,
    successKey: string,
  ) => {
    const error = await executeClaimAction(claim, actionId, endpoint, body)
    if (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: reload })) return
      flash(error instanceof Error ? error.message : t('warranty_claims.list.error.action'), 'error')
      return
    }
    flash(t(successKey), 'success')
    reload()
  }, [executeClaimAction, reload, t])

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

  const flashBulkSummary = React.useCallback((succeeded: number, failures: BulkFailure[]) => {
    const summary = t(
      'warranty_claims.bulk.summary',
      'Bulk action finished: {succeeded} succeeded, {failed} failed.',
      { succeeded, failed: failures.length },
    )
    if (failures.length) {
      flash(
        `${summary} ${t('warranty_claims.bulk.firstError', 'First error: {message}', { message: failures[0].message })}`,
        'warning',
      )
      return
    }
    flash(summary, 'success')
  }, [t])

  const runBulkAssign = React.useCallback(async (selectedRows: ClaimRow[], assigneeUserId: string | null) => {
    let succeeded = 0
    const failures: BulkFailure[] = []
    for (const claim of selectedRows) {
      const error = await executeClaimAction(
        claim,
        'bulk-assign',
        '/api/warranty_claims/assign',
        { id: claim.id, assigneeUserId },
      )
      if (error) failures.push({ message: error instanceof Error ? error.message : t('warranty_claims.list.error.action') })
      else succeeded += 1
    }
    flashBulkSummary(succeeded, failures)
    reload()
    return { ok: true as const, affectedCount: succeeded }
  }, [executeClaimAction, flashBulkSummary, reload, t])

  const runBulkCancel = React.useCallback(async (selectedRows: ClaimRow[]) => {
    let succeeded = 0
    const failures: BulkFailure[] = []
    for (const claim of selectedRows) {
      const error = await executeClaimAction(
        claim,
        'bulk-cancel',
        '/api/warranty_claims/transition',
        { id: claim.id, toStatus: 'cancelled' },
      )
      if (error) failures.push({ message: error instanceof Error ? error.message : t('warranty_claims.list.error.action') })
      else succeeded += 1
    }
    flashBulkSummary(succeeded, failures)
    reload()
    return { ok: true as const, affectedCount: succeeded }
  }, [executeClaimAction, flashBulkSummary, reload, t])

  const closeAssignDialog = React.useCallback((result: false | { ok: true; affectedCount?: number } = false) => {
    setAssignDialog((current) => {
      current?.resolve?.(result)
      return null
    })
  }, [])

  const assignFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'assigneeUserId',
      label: t('warranty_claims.form.assigneeUserId'),
      type: 'combobox',
      placeholder: t('warranty_claims.form.assigneeUserId.searchPlaceholder', 'Search staff'),
      loadOptions: loadAssignableStaffOptions,
      seedOptions: assignSeedOptions,
      allowCustomValues: false,
    },
  ], [assignSeedOptions, loadAssignableStaffOptions, t])

  const bulkActions = React.useMemo<BulkAction<ClaimRow>[]>(() => [
    {
      id: 'bulk-assign',
      label: t('warranty_claims.bulk.assign', 'Assign selected'),
      onExecute: (selectedRows) => new Promise<false | { ok: true; affectedCount?: number }>((resolve) => {
        if (!selectedRows.length) {
          resolve(false)
          return
        }
        setAssignDialog({ mode: 'bulk', rows: selectedRows, resolve })
      }),
    },
    {
      id: 'bulk-cancel',
      label: t('warranty_claims.bulk.cancel', 'Cancel selected'),
      destructive: true,
      onExecute: async (selectedRows) => {
        if (!selectedRows.length) return false
        const confirmed = await confirm({
          title: t('warranty_claims.bulk.cancelTitle', 'Cancel selected claims?'),
          variant: 'destructive',
        })
        if (!confirmed) return false
        return runBulkCancel(selectedRows)
      },
    },
  ], [confirm, runBulkCancel, t])

  const applyMyClaimsFilter = React.useCallback(() => {
    if (!currentUserId) return
    setFilterValues((current) => {
      const next: FilterValues = { ...current }
      if (toStringOrNull(current.assigneeUserId) === currentUserId) delete next.assigneeUserId
      else next.assigneeUserId = currentUserId
      return next
    })
    setPage(1)
  }, [currentUserId])

  const applyOverdueFilter = React.useCallback(() => {
    setFilterValues((current) => {
      const next: FilterValues = { ...current }
      if (current.overdueOnly === true) delete next.overdueOnly
      else next.overdueOnly = true
      return next
    })
    setPage(1)
  }, [])

  const applyStatusGroupFilter = React.useCallback((statuses: ClaimStatus[]) => {
    setFilterValues((current) => {
      const next: FilterValues = { ...current }
      if (sameStringSet(valueAsStringArray(current.status), statuses)) delete next.status
      else next.status = statuses
      return next
    })
    setPage(1)
  }, [])

  const handleSortingChange = React.useCallback((nextSorting: SortingState) => {
    setSorting(nextSorting.length ? nextSorting : defaultSortingState())
    setPage(1)
  }, [])

  const currentStatusFilter = valueAsStringArray(filterValues.status)
  const myClaimsActive = Boolean(currentUserId) && toStringOrNull(filterValues.assigneeUserId) === currentUserId
  const overdueActive = filterValues.overdueOnly === true
  const openByStatus = stats?.openByStatus ?? {}

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
        accessorKey: 'channel',
        header: t('warranty_claims.list.column.channel'),
        cell: ({ row }) => {
          const value = normalizeClaimChannel(row.original.channel)
          return value ? <StatusBadge variant="neutral">{t(`warranty_claims.channel.${value}`)}</StatusBadge> : noValue
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
        cell: ({ row }) => <ClaimPriorityBadge priority={row.original.priority} />,
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
        cell: ({ row }) => (
          <ClaimSlaIndicator
            slaDueAt={row.original.slaDueAt}
            slaPausedAt={row.original.slaPausedAt}
            submittedAt={row.original.submittedAt}
            status={row.original.status}
            atRiskThresholdPct={stats?.slaAtRiskThresholdPct}
          />
        ),
      },
      {
        accessorKey: 'assigneeUserId',
        header: t('warranty_claims.list.column.assignee'),
        cell: ({ row }) => row.original.assigneeUserId ? <span className="font-mono text-xs">{shortId(row.original.assigneeUserId)}</span> : noValue,
      },
      {
        accessorKey: 'updatedAt',
        header: t('warranty_claims.list.column.updatedAt'),
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDateTime(row.original.updatedAt) ?? t('warranty_claims.common.noValue')}</span>,
      },
    ]
  }, [stats?.slaAtRiskThresholdPct, t])

  const assignInitialAssignee =
    assignDialog?.rows.length === 1
      ? assignDialog.rows[0].assigneeUserId ?? UNASSIGNED_ASSIGNEE_VALUE
      : UNASSIGNED_ASSIGNEE_VALUE
  const assignDialogTitle = assignDialog?.mode === 'bulk'
    ? t('warranty_claims.bulk.assignTitle', 'Assign selected claims')
    : t('warranty_claims.detail.actions.assign')

  return (
    <Page>
      <PageBody>
        <div className="space-y-4">
          <ClaimsKpiStrip
            stats={stats}
            isLoading={statsLoading}
            hasError={statsError}
            onOverdueClick={applyOverdueFilter}
            onAssignedToMeClick={applyMyClaimsFilter}
          />

          <div
            className="flex flex-wrap items-center gap-2"
            aria-label={t('warranty_claims.list.quickFilters.label', 'Claim queue filters')}
          >
            <Button
              type="button"
              size="sm"
              variant={myClaimsActive ? 'default' : 'outline'}
              disabled={!currentUserId}
              onClick={applyMyClaimsFilter}
            >
              {t('warranty_claims.list.quickFilters.myClaims', 'My claims')}
              <span className="font-mono text-xs tabular-nums">{stats?.assignedToMe ?? 0}</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant={overdueActive ? 'default' : 'outline'}
              onClick={applyOverdueFilter}
            >
              {t('warranty_claims.list.quickFilters.overdue', 'Overdue')}
              <span className="font-mono text-xs tabular-nums">{stats?.overdue ?? 0}</span>
            </Button>

            {STATUS_GROUPS.map((group) => {
              const active = sameStringSet(currentStatusFilter, group.statuses)
              const count = group.statuses.reduce((sum, status) => sum + (openByStatus[status] ?? 0), 0)
              return (
                <Button
                  key={group.id}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  onClick={() => applyStatusGroupFilter(group.statuses)}
                >
                  {t(group.labelKey, group.fallback)}
                  <span className="font-mono text-xs tabular-nums">{count}</span>
                </Button>
              )
            })}
          </div>

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
            }}
            searchPlaceholder={t('warranty_claims.list.searchPlaceholder')}
            filters={filters}
            filterValues={filterValues}
            onFiltersApply={(values) => {
              setFilterValues((current) => {
                const next: FilterValues = { ...values }
                const assigneeUserId = toStringOrNull(current.assigneeUserId)
                if (assigneeUserId) next.assigneeUserId = assigneeUserId
                return next
              })
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
            onSortingChange={handleSortingChange}
            isLoading={loading}
            bulkActions={bulkActions}
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
                    onSelect: () => setAssignDialog({ mode: 'single', rows: [row] }),
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
        </div>
      </PageBody>
      <Dialog open={assignDialog !== null} onOpenChange={(open) => { if (!open) closeAssignDialog(false) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{assignDialogTitle}</DialogTitle>
          </DialogHeader>
          <CrudForm<AssignFormValues>
            embedded
            title={assignDialogTitle}
            fields={assignFields}
            initialValues={{ assigneeUserId: assignInitialAssignee }}
            submitLabel={t('warranty_claims.form.submit')}
            onSubmit={async (values) => {
              if (!assignDialog) return
              const assigneeUserId = normalizeAssigneeValue(values.assigneeUserId)
              if (assignDialog.mode === 'bulk') {
                const result = await runBulkAssign(assignDialog.rows, assigneeUserId)
                closeAssignDialog(result)
                return
              }
              const target = assignDialog.rows[0]
              if (!target) {
                closeAssignDialog(false)
                return
              }
              await runClaimAction(
                target,
                'assign',
                '/api/warranty_claims/assign',
                { id: target.id, assigneeUserId },
                'warranty_claims.list.flash.assigned',
              )
              closeAssignDialog({ ok: true, affectedCount: 1 })
            }}
          />
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </Page>
  )
}
