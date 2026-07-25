"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type DataTableExportFormat, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { createEmptyTree, makeRuleTree, makeMultiRuleTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { deserializeTree, deserializeAdvancedFilter, flatToTree, mapDictionaryColorToTone, serializeTree, type FilterFieldDef, type FilterOption as AdvancedFilterOption } from '@open-mercato/shared/lib/query/advanced-filter'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { buildCrudExportUrl, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { groupBulkDeleteFailures, runBulkDelete } from '@open-mercato/ui/backend/utils/bulkDelete'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { coalesceLastOperations } from '@open-mercato/ui/backend/operations/store'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { Briefcase, AlertTriangle, X } from 'lucide-react'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { ViewTabsRow } from './pipeline/components/ViewTabsRow'
import { DealsKpiStrip } from '../../../components/DealsKpiStrip'
import { E } from '#generated/entities.ids.generated'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  type CustomerDictionaryKind,
  type CustomerDictionaryMap,
} from '../../../lib/dictionaries'
import {
  ensureCustomerDictionary,
  invalidateCustomerDictionary,
} from '../../../components/detail/hooks/useCustomerDictionary'
import {
  useCustomFieldDefs,
} from '@open-mercato/ui/backend/utils/customFieldDefs'
import {
  mapCustomFieldKindToFilterType,
  normalizeCustomFieldFilterOptions,
  supportsCustomFieldColumn,
} from '@open-mercato/ui/backend/utils/customFieldColumns'
import { CollectionPreviewCell, normalizeCollectionLabels } from '../../../components/list/CollectionPreviewCell'
import { useAutoDiscoveredFields } from '@open-mercato/ui/backend/utils/useAutoDiscoveredFields'
import { useAdvancedFilterTree } from '@open-mercato/ui/backend/hooks/useAdvancedFilter'
import { AdvancedFilterPanel } from '@open-mercato/ui/backend/filters/AdvancedFilterPanel'
import { ActiveFilterChips } from '@open-mercato/ui/backend/filters/ActiveFilterChips'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { FilterPreset } from '@open-mercato/ui/backend/filters/QuickFilters'
import {
  ensureCurrentUserFilterOption,
  fetchAssignableStaffMembers,
  mapAssignableStaffToFilterOptions,
} from '../../../components/detail/assignableStaff'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

function makeDealsPresets(): FilterPreset[] {
  return [
    {
      id: 'my-deals',
      labelKey: 'customers.deals.presets.myDeals',
      requiresUser: true,
      build: ({ userId }) => makeRuleTree({ field: 'owner_user_id', operator: 'is', value: userId }),
    },
    {
      id: 'closing-month',
      labelKey: 'customers.deals.presets.closingMonth',
      iconName: 'clock',
      build: ({ now }) => {
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
        return makeRuleTree({ field: 'expected_close_at', operator: 'between', value: [start, end] })
      },
    },
    // The Deal entity has no dedicated "at risk" or health-score field — `customer_deals`
    // exposes only `status` (open/win/loose/closed/in_progress, dictionary-driven) and
    // `closure_outcome`. Rather than fabricate a mapping, the "At risk" preset is omitted
    // until the data model exposes a first-class signal.
    {
      id: 'won-quarter',
      labelKey: 'customers.deals.presets.wonQuarter',
      build: ({ now }) => {
        const quarter = Math.floor(now.getMonth() / 3)
        const start = new Date(now.getFullYear(), quarter * 3, 1).toISOString().slice(0, 10)
        return makeMultiRuleTree([
          { field: 'status', operator: 'is', value: 'win' },
          { field: 'expected_close_at', operator: 'is_after', value: start },
        ], 'and')
      },
    },
  ]
}

type DealRow = {
  id: string
  title: string
  status?: string | null
  pipelineStage?: string | null
  pipelineStageId?: string | null
  pipelineId?: string | null
  valueAmount?: number | null
  valueCurrency?: string | null
  probability?: number | null
  expectedCloseAt?: string | null
  updatedAt?: string | null
  ownerUserId?: string | null
  companies: { id: string; label: string }[]
  people: { id: string; label: string }[]
} & Record<string, unknown>

type DealsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type FilterOption = { value: string; label: string }
type DictionaryOptionWithTone = AdvancedFilterOption & FilterOption

type DictionaryKey = Extract<CustomerDictionaryKind, 'deal-statuses' | 'pipeline-stages'>

const PAGE_SIZE = 20
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string | null | undefined): value is string {
  if (!value) return false
  return UUID_REGEX.test(value.trim())
}

function normalizeIdCandidates(raw: Array<string>): string[] {
  const set = new Set<string>()
  raw.forEach((candidate) => {
    candidate
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .forEach((part) => {
        if (isUuid(part)) set.add(part)
      })
  })
  return Array.from(set)
}

function extractIdsFromParams(params: URLSearchParams | null | undefined, key: string): string[] {
  if (!params) return []
  const values = params.getAll(key)
  return normalizeIdCandidates(values)
}

function formatDateValue(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString()
}

const STATUS_BADGE_VARIANTS: ReadonlySet<StatusBadgeVariant> = new Set([
  'success',
  'warning',
  'error',
  'info',
  'neutral',
])

function coerceStatusBadgeVariant(
  tone: ReturnType<typeof mapDictionaryColorToTone>,
): StatusBadgeVariant {
  if (tone && STATUS_BADGE_VARIANTS.has(tone as StatusBadgeVariant)) {
    return tone as StatusBadgeVariant
  }
  return 'neutral'
}

const groupedAmountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

function formatGroupedAmount(amount: number | null | undefined): string | null {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return null
  return groupedAmountFormatter.format(amount)
}

export default function CustomersDealsPage() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()

  const [rows, setRows] = React.useState<DealRow[]>([])
  const [page, setPage] = React.useState(() => {
    const raw = Number(searchParams?.get('page') ?? '1')
    return Number.isFinite(raw) && raw > 0 ? raw : 1
  })
  const [pageSize, setPageSize] = React.useState(PAGE_SIZE)
  const [sorting, setSorting] = React.useState<import('@tanstack/react-table').SortingState>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState(() => searchParams?.get('search')?.trim() ?? '')
  const [isLoading, setIsLoading] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const [needsAttentionOnly, setNeedsAttentionOnly] = React.useState(() => searchParams?.get('needsAttention') === 'true')
  // One-shot URL hydration used as the hook's initial value. The hook is the
  // single source of truth from this point on — the page MUST NOT keep a
  // parallel `useState<AdvancedFilterTree>` (see spec "Migration & Backward
  // Compatibility" → state ownership).
  const initialFilterTree = React.useMemo<AdvancedFilterTree>(() => {
    if (!searchParams) return createEmptyTree()
    const record: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      if (key.startsWith('filter[')) record[key] = value
    })
    const v2 = deserializeTree(record)
    if (v2) return v2
    const flat = deserializeAdvancedFilter(record)
    if (flat) return flatToTree(flat)
    return createEmptyTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // `filterPanel` lives at the top of the component so derived state below
  // (URL params, data fetch, export config) can read `filterPanel.appliedTree`
  // directly. Real `FilterFieldDef[]` arrives later from `useAutoDiscoveredFields`
  // (it depends on columns) and is synced into the hook via a small effect at
  // the bottom of the component. The hook reads fields through a ref at
  // validation time only — first validation cannot fire before user input, by
  // which point fields have settled, so the empty initial value is safe.
  const [panelFields, setPanelFields] = React.useState<FilterFieldDef[]>([])
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const filtersTriggerRef = React.useRef<HTMLButtonElement | null>(null)
  const filterPanel = useAdvancedFilterTree({
    initial: initialFilterTree,
    fields: panelFields,
    onApply: () => setPage(1),
  })
  const advancedFilterState = filterPanel.appliedTree
  const handleAdvancedFilterClear = React.useCallback(() => {
    filterPanel.clear()
    setPage(1)
  }, [filterPanel])
  const [cacheStatus, setCacheStatus] = React.useState<'hit' | 'miss' | null>(null)

  const initialPersonIds = React.useMemo(
    () => extractIdsFromParams(searchParams, 'personId'),
    [searchParams],
  )
  const initialCompanyIds = React.useMemo(
    () => extractIdsFromParams(searchParams, 'companyId'),
    [searchParams],
  )

  const [selectedPersonIds, setSelectedPersonIds] = React.useState<string[]>(initialPersonIds)
  const [selectedCompanyIds, setSelectedCompanyIds] = React.useState<string[]>(initialCompanyIds)

  const [dictionaryMaps, setDictionaryMaps] = React.useState<Record<DictionaryKey, CustomerDictionaryMap>>({
    'deal-statuses': {},
    'pipeline-stages': {},
  })

  const [pipelineNames, setPipelineNames] = React.useState<Record<string, string>>({})

  const fetchDictionaryEntries = React.useCallback(
    async (kind: DictionaryKey) => {
      try {
        const data = await ensureCustomerDictionary(queryClient, kind, scopeVersion)
        setDictionaryMaps((prev) => ({ ...prev, [kind]: data.map }))
      } catch {
        setDictionaryMaps((prev) => ({ ...prev, [kind]: {} }))
      }
    },
    [queryClient, scopeVersion],
  )

  React.useEffect(() => {
    let cancelled = false
    async function loadDictionaries() {
      if (cancelled) return
      await Promise.all([fetchDictionaryEntries('deal-statuses'), fetchDictionaryEntries('pipeline-stages')])
    }
    loadDictionaries().catch(() => {})
    return () => { cancelled = true }
  }, [fetchDictionaryEntries, reloadToken])
  const dictionaryOptions = React.useMemo(() => {
    const toOptions = (map?: CustomerDictionaryMap | null): DictionaryOptionWithTone[] =>
      Object.values(map ?? {})
        .map((entry) => {
          const tone = mapDictionaryColorToTone(entry.color)
          const option: DictionaryOptionWithTone = { value: entry.value, label: entry.label }
          if (tone) option.tone = tone
          return option
        })
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    return {
      dealStatuses: toOptions(dictionaryMaps['deal-statuses']),
      pipelineStages: toOptions(dictionaryMaps['pipeline-stages']),
    }
  }, [dictionaryMaps])

  React.useEffect(() => {
    let cancelled = false
    async function loadPipelines() {
      try {
        const call = await apiCall<{ items?: Array<{ id: string; name: string }> }>('/api/customers/pipelines')
        if (cancelled || !call.ok) return
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const map: Record<string, string> = {}
        items.forEach((p) => { if (p.id && p.name) map[p.id] = p.name })
        setPipelineNames(map)
      } catch (err) {
        logger.warn('failed to load pipelines', { component: 'deals.list', err })
      }
    }
    loadPipelines().catch((err) => {
      logger.warn('loadPipelines threw', { component: 'deals.list', err })
    })
    return () => { cancelled = true }
  }, [reloadToken, scopeVersion])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value.trim())
    setPage(1)
  }, [])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (sorting.length > 0) {
      params.set('sort', sorting[0].id)
      params.set('order', sorting[0].desc ? 'desc' : 'asc')
    }
    if (search.trim().length) params.set('search', search.trim())
    if (selectedPersonIds.length) params.set('personId', selectedPersonIds.join(','))
    if (selectedCompanyIds.length) params.set('companyId', selectedCompanyIds.join(','))
    if (needsAttentionOnly) params.set('needsAttention', 'true')
    const advancedParams = serializeTree(advancedFilterState)
    for (const [key, val] of Object.entries(advancedParams)) {
      params.set(key, val)
    }
    return params.toString()
  }, [advancedFilterState, needsAttentionOnly, page, pageSize, search, selectedCompanyIds, selectedPersonIds, sorting])

  const currentParams = React.useMemo(
    () => Object.fromEntries(new URLSearchParams(queryParams)),
    [queryParams],
  )

  const exportConfig = React.useMemo(() => ({
    view: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('customers/deals', { ...currentParams, exportScope: 'view' }, format),
    },
    full: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('customers/deals', { ...currentParams, exportScope: 'full', all: 'true' }, format),
    },
  }), [currentParams])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setCacheStatus(null)
      try {
        const fallback: DealsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<DealsResponse>(`/api/customers/deals?${queryParams}`, undefined, { fallback })
        if (!call.ok) {
          const message =
            typeof (call.result as { error?: string } | undefined)?.error === 'string'
              ? (call.result as { error?: string }).error!
              : t('customers.deals.list.error.load')
          flash(message, 'error')
          if (!cancelled) setCacheStatus(null)
          return
        }
        const payload = call.result ?? fallback
        if (cancelled) return
        setCacheStatus(call.cacheStatus ?? null)
        const items = Array.isArray(payload.items) ? payload.items : []
        const mapped = items
          .map((item) => mapDeal(item as Record<string, unknown>))
          .filter((row): row is DealRow => !!row)
        setRows(mapped)
        setTotal(typeof payload.total === 'number' ? payload.total : mapped.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (!cancelled) {
          setCacheStatus(null)
          const message = err instanceof Error ? err.message : t('customers.deals.list.error.load')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [queryParams, reloadToken, scopeVersion, t])

  React.useEffect(() => {
    if (totalPages > 0 && page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const queryRef = React.useRef(searchParams?.toString() ?? '')
  React.useEffect(() => {
    if (!pathname) return
    const params = new URLSearchParams()
    if (search.trim().length) params.set('search', search.trim())
    if (selectedPersonIds.length) selectedPersonIds.forEach((id) => params.append('personId', id))
    if (selectedCompanyIds.length) selectedCompanyIds.forEach((id) => params.append('companyId', id))
    if (needsAttentionOnly) params.set('needsAttention', 'true')
    if (page > 1) params.set('page', String(page))
    const advancedParams = serializeTree(advancedFilterState)
    for (const [key, val] of Object.entries(advancedParams)) {
      params.set(key, val)
    }
    const next = params.toString()
    if (queryRef.current === next) return
    queryRef.current = next
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
  }, [pathname, router, page, search, selectedPersonIds, selectedCompanyIds, needsAttentionOnly, advancedFilterState])

  const handleRefresh = React.useCallback(() => {
    void Promise.all([
      invalidateCustomerDictionary(queryClient, 'deal-statuses'),
      invalidateCustomerDictionary(queryClient, 'pipeline-stages'),
    ])
    setReloadToken((token) => token + 1)
  }, [queryClient])

  const bulkMutationContextId = 'customers-deals-list:bulk-delete'
  const { runMutation: runBulkMutation, retryLastMutation: retryBulkMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: bulkMutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const singleMutationContextId = 'customers-deals-list:single-delete'
  const { runMutation: runSingleMutation, retryLastMutation: retrySingleMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: singleMutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const handleDeleteDeal = React.useCallback(
    async (dealId: string) => {
      if (pendingDeleteId) return
      const confirmed = await confirm({
        title: t(
          'customers.deals.list.deleteConfirm',
          'Delete this deal? This action cannot be undone.',
        ),
        variant: 'destructive',
      })
      if (!confirmed) return
      const lockVersion = rows.find((row) => row.id === dealId)?.updatedAt ?? null
      setPendingDeleteId(dealId)
      try {
        await runSingleMutation({
          operation: async () => {
            await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(lockVersion),
              () => deleteCrud('customers/deals', {
                body: { id: dealId },
                errorMessage: t('customers.deals.list.deleteError', 'Failed to delete deal.'),
              }),
            )
          },
          context: {
            formId: singleMutationContextId,
            resourceKind: 'customers.deal',
            resourceId: dealId,
            retryLastMutation: retrySingleMutation,
          },
        })
        flash(t('customers.deals.list.deleteSuccess', 'Deal deleted.'), 'success')
        setRows((prev) => prev.filter((row) => row.id !== dealId))
        setTotal((prev) => Math.max(0, prev - 1))
        handleRefresh()
      } catch (err) {
        // A stale delete surfaces the unified conflict bar (via the guarded
        // mutation) — skip the generic error flash to avoid a double message (#2332).
        if (surfaceRecordConflict(err, t)) {
          handleRefresh()
          return
        }
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('customers.deals.list.deleteError', 'Failed to delete deal.')
        flash(message, 'error')
      } finally {
        setPendingDeleteId(null)
      }
    },
    [confirm, handleRefresh, pendingDeleteId, retrySingleMutation, rows, runSingleMutation, singleMutationContextId, t],
  )

  const handlePageSizeChange = React.useCallback((newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }, [])

  const handleNeedsAttentionFilter = React.useCallback(() => {
    setNeedsAttentionOnly(true)
    setPage(1)
  }, [])

  const handleNeedsAttentionClear = React.useCallback(() => {
    setNeedsAttentionOnly(false)
    setPage(1)
  }, [])

  const handleBulkDelete = React.useCallback(async (selectedRows: DealRow[]) => {
    const confirmed = await confirm({
      title: t('customers.deals.list.bulkDelete.title', 'Delete {count} deals?', { count: selectedRows.length }),
      description: t('customers.deals.list.bulkDelete.description', 'This action cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return false

    const { succeeded, failures } = await runBulkMutation({
      operation: async () =>
        runBulkDelete(
          selectedRows,
          async (row) => {
            await deleteCrud('customers/deals', {
              body: { id: row.id },
              errorMessage: t('customers.deals.list.deleteError', 'Failed to delete deal.'),
            })
          },
          {
            fallbackErrorMessage: t('customers.deals.list.deleteError', 'Failed to delete deal.'),
            logTag: 'customers.deals.list',
            progress: {
              jobType: 'customers.deals.bulk_delete',
              name: t('customers.deals.list.bulkDelete.progressName', 'Delete selected deals'),
              description: t(
                'customers.deals.list.bulkDelete.progressDescription',
                '{count} deals selected for deletion',
                { count: selectedRows.length },
              ),
              meta: { source: 'customers.deals.list' },
            },
          },
        ),
      context: {
        formId: bulkMutationContextId,
        resourceKind: 'customers.deal',
        retryLastMutation: retryBulkMutation,
      },
    })

    if (succeeded.length > 0) {
      const succeededIds = new Set(succeeded.map((r) => r.id))
      setRows((prev) => prev.filter((r) => !succeededIds.has(r.id)))
      setTotal((prev) => Math.max(0, prev - succeeded.length))
      setReloadToken((prev) => prev + 1)
      if (succeeded.length > 1) {
        coalesceLastOperations(succeeded.length, {
          commandId: 'customers.deals.delete',
          actionLabel: t('customers.deals.list.bulkDelete.operationLabel', 'Delete {count} deals', { count: succeeded.length }),
          resourceKind: 'customers.deal',
        })
      }
      if (failures.length === 0) {
        flash(
          t('customers.deals.list.bulkDelete.success', '{count} deals deleted', { count: succeeded.length }),
          'success',
        )
      } else {
        flash(
          t('customers.deals.list.bulkDelete.partial', '{deleted} of {total} deals deleted; {failed} failed', {
            deleted: succeeded.length,
            total: selectedRows.length,
            failed: failures.length,
          }),
          'warning',
        )
      }
    }

    for (const group of groupBulkDeleteFailures(failures)) {
      const message = group.count === 1
        ? group.sampleMessage
        : t(
            'customers.deals.list.bulkDelete.failedGroup',
            '{count} deals could not be deleted: {message}',
            { count: group.count, message: group.sampleMessage },
          )
      flash(message, 'error')
    }

    return succeeded.length > 0
  }, [bulkMutationContextId, confirm, retryBulkMutation, runBulkMutation, t])

  const { data: customFieldDefs = [] } = useCustomFieldDefs([E.customers.customer_deal], {
    keyExtras: [scopeVersion, reloadToken],
  })
  const currentUserId = useCurrentUserId()
  const [ownerFilterOptions, setOwnerFilterOptions] = React.useState<AdvancedFilterOption[]>([])
  // Single staff load drives both the owner FILTER options and the owner-name
  // map shared with the OWNER cell + the KPI strip (userId → display name).
  // No per-row fetch — see spec audit "Owner names" resolution.
  const [ownerNames, setOwnerNames] = React.useState<Record<string, string>>({})
  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    void fetchAssignableStaffMembers('', { pageSize: 100, signal: controller.signal })
      .then((items) => {
        if (cancelled) return
        setOwnerFilterOptions(mapAssignableStaffToFilterOptions(items))
        const names: Record<string, string> = {}
        for (const item of items) {
          if (item.userId) names[item.userId] = item.displayName
        }
        setOwnerNames(names)
      })
      .catch(() => {
        if (cancelled) return
        setOwnerFilterOptions([])
        setOwnerNames({})
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [scopeVersion])
  const resolvedOwnerFilterOptions = React.useMemo(
    () => ensureCurrentUserFilterOption(
      ownerFilterOptions,
      currentUserId,
      t('customers.filters.currentUser', 'Current user'),
    ),
    [currentUserId, ownerFilterOptions, t],
  )
  const loadOwnerFilterOptions = React.useCallback(async (query?: string): Promise<AdvancedFilterOption[]> => {
    const items = await fetchAssignableStaffMembers(query ?? '', { pageSize: 100 })
    return mapAssignableStaffToFilterOptions(items)
  }, [])

  const startOfToday = React.useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
  }, [])
  const isDealOverdue = React.useCallback(
    (row: DealRow): boolean =>
      !!row.expectedCloseAt && new Date(row.expectedCloseAt) < startOfToday && row.status === 'open',
    [startOfToday],
  )

  const columns = React.useMemo<ColumnDef<DealRow>[]>(() => {
    const noValue = <span className="text-muted-foreground text-sm">{t('customers.deals.list.noValue')}</span>
    const unknownOwner = t('customers.deals.list.unknownOwner')

    const customColumns = customFieldDefs
      .filter((def) => supportsCustomFieldColumn(def))
      .map<ColumnDef<DealRow>>((def) => ({
        accessorKey: `cf_${def.key}`,
        header: def.label || def.key,
        meta: {
          columnChooserGroup: def.group?.title ?? 'Custom Fields',
          filterGroup: def.group?.title ?? 'Custom Fields',
          filterType: mapCustomFieldKindToFilterType(def.kind),
          filterOptions: normalizeCustomFieldFilterOptions(def.options),
          hidden: def.listVisible === false,
          maxWidth: '220px',
        },
        cell: ({ getValue }) => {
          const value = getValue()
          if (value == null) return noValue
          if (Array.isArray(value)) {
            const normalized = normalizeCollectionLabels(
              value
                .map((item) => {
                  if (item == null) return ''
                  if (typeof item === 'string') return item
                  return String(item)
                }),
            )
            if (!normalized.length) return noValue
            return <CollectionPreviewCell labels={normalized} maxVisible={2} />
          }
          if (typeof value === 'boolean') {
            return (
              <span className="text-sm">
                {value
                  ? t('customers.deals.list.booleanYes', 'Yes')
                  : t('customers.deals.list.booleanNo', 'No')}
              </span>
            )
          }
          const stringValue = typeof value === 'string' ? value.trim() : String(value)
          if (!stringValue) return noValue
          return <span className="text-sm">{stringValue}</span>
        },
      }))

    return [
      {
        accessorKey: 'title',
        header: t('customers.deals.list.columns.title'),
        meta: {
          alwaysVisible: true,
          columnChooserGroup: 'Basic Info',
          filterKey: 'title',
          filterGroup: 'Deal',
          maxWidth: '280px',
        },
        cell: ({ row }) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Briefcase className="h-4 w-4" />
            </span>
            <span className="font-medium text-foreground truncate">{row.original.title}</span>
            {isDealOverdue(row.original) ? (
              <AlertTriangle
                className="h-4 w-4 shrink-0 text-status-warning-text"
                aria-label={t('customers.deals.list.close.overdue')}
              />
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: t('customers.deals.list.columns.status'),
        meta: {
          filterType: 'select' as const,
          filterOptions: dictionaryOptions.dealStatuses,
          columnChooserGroup: 'Basic Info',
          filterKey: 'status',
          filterGroup: 'Deal',
        },
        cell: ({ row }) => {
          const status = row.original.status
          if (!status) return noValue
          const entry = dictionaryMaps['deal-statuses']?.[status]
          const label = entry?.label ?? status
          const variant = coerceStatusBadgeVariant(mapDictionaryColorToTone(entry?.color))
          return <StatusBadge variant={variant} dot>{label}</StatusBadge>
        },
      },
      {
        accessorKey: 'pipelineStage',
        header: t('customers.deals.list.columns.pipelineStage'),
        meta: {
          filterType: 'select' as const,
          filterOptions: dictionaryOptions.pipelineStages,
          columnChooserGroup: 'Pipeline',
          filterKey: 'pipeline_stage',
          filterGroup: 'Deal',
        },
        cell: ({ row }) => {
          const stage = row.original.pipelineStage
          if (!stage) return noValue
          const label = dictionaryMaps['pipeline-stages']?.[stage]?.label ?? stage
          return <span className="text-foreground">{label}</span>
        },
      },
      {
        accessorKey: 'pipelineId',
        header: t('customers.deals.list.columns.pipeline', 'Pipeline'),
        meta: {
          columnChooserGroup: 'Pipeline',
          filterKey: 'pipeline_id',
          filterGroup: 'Deal',
          maxWidth: '220px',
        },
        cell: ({ row }) => {
          const name = row.original.pipelineId ? pipelineNames[row.original.pipelineId] : null
          return name ? <span className="text-sm">{name}</span> : noValue
        },
      },
      {
        accessorKey: 'valueAmount',
        header: t('customers.deals.list.columns.value'),
        meta: {
          filterType: 'number' as const,
          columnChooserGroup: 'Financial',
          filterKey: 'value_amount',
          filterGroup: 'Deal',
        },
        cell: ({ row }) => {
          const amount = formatGroupedAmount(row.original.valueAmount ?? null)
          if (amount === null) return noValue
          const currency = row.original.valueCurrency
          return (
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{amount}</span>
              {currency ? <span className="text-xs text-muted-foreground">{currency}</span> : null}
            </div>
          )
        },
      },
      {
        accessorKey: 'probability',
        header: t('customers.deals.list.columns.probability'),
        meta: {
          filterType: 'number' as const,
          columnChooserGroup: 'Financial',
          filterKey: 'probability',
          filterGroup: 'Deal',
        },
        cell: ({ row }) => {
          const value = row.original.probability
          if (typeof value === 'number' && Number.isFinite(value)) {
            return <span className="font-medium text-foreground">{`${Math.min(Math.max(value, 0), 100)}%`}</span>
          }
          return noValue
        },
      },
      {
        accessorKey: 'expectedCloseAt',
        header: t('customers.deals.list.columns.expectedClose'),
        meta: {
          columnChooserGroup: 'Dates',
          filterKey: 'expected_close_at',
          filterGroup: 'Activity',
          filterIconName: 'calendar',
        },
        cell: ({ row }) => {
          const expectedCloseAt = row.original.expectedCloseAt
          if (!expectedCloseAt) return noValue
          let subtitle: React.ReactNode = null
          if (isDealOverdue(row.original)) {
            subtitle = (
              <span className="text-xs text-status-error-text">{t('customers.deals.list.close.overdue')}</span>
            )
          } else if (row.original.status === 'win') {
            subtitle = (
              <span className="text-xs text-muted-foreground">{t('customers.deals.list.close.won')}</span>
            )
          } else if (row.original.status === 'loose') {
            subtitle = (
              <span className="text-xs text-muted-foreground">{t('customers.deals.list.close.lost')}</span>
            )
          } else {
            const relative = formatRelativeTime(expectedCloseAt, { translate: t })
            if (relative) {
              subtitle = <span className="text-xs text-muted-foreground">{relative}</span>
            }
          }
          return (
            <div className="flex flex-col">
              <span className="text-foreground">
                {formatDateValue(expectedCloseAt, t('customers.deals.list.noValue'))}
              </span>
              {subtitle}
            </div>
          )
        },
      },
      {
        accessorKey: 'ownerUserId',
        header: t('customers.deals.list.columns.owner', 'Owner'),
        meta: {
          columnChooserGroup: 'CRM',
          filterType: 'select',
          filterOptions: resolvedOwnerFilterOptions,
          filterLoadOptions: loadOwnerFilterOptions,
          filterGroup: 'CRM',
          filterIconName: 'user-round',
          filterKey: 'owner_user_id',
        },
        cell: ({ row }) => {
          const ownerUserId = row.original.ownerUserId
          if (!ownerUserId) return noValue
          const label = ownerNames[ownerUserId]?.trim() || unknownOwner
          return (
            <div className="flex items-center gap-2 min-w-0">
              <Avatar label={label} size="sm" />
              <span className="text-foreground truncate">{label}</span>
            </div>
          )
        },
      },
      {
        accessorKey: 'companies',
        header: t('customers.deals.list.columns.companies'),
        meta: {
          columnChooserGroup: 'Associations',
          filterable: false,
          filterGroup: 'CRM',
          filterIconName: 'building-2',
          maxWidth: '220px',
          tooltipContent: (row: DealRow) =>
            normalizeCollectionLabels(
              row.companies.map((entry) => (entry.label && entry.label.trim().length ? entry.label : t('customers.deals.list.unnamedCompany'))),
            ).join(', '),
        },
        cell: ({ row }) => {
          const companies = row.original.companies
          if (!companies.length) return noValue
          const first = companies[0]
          const firstLabel =
            first.label && first.label.trim().length ? first.label : t('customers.deals.list.unnamedCompany')
          const overflow = companies.length - 1
          return (
            <div className="flex items-center gap-1.5 min-w-0">
              <Tag variant="neutral" className="max-w-36">
                <span className="truncate">{firstLabel}</span>
              </Tag>
              {overflow > 0 ? <Tag variant="neutral">{`+${overflow}`}</Tag> : null}
            </div>
          )
        },
      },
      {
        accessorKey: 'people',
        header: t('customers.deals.list.columns.people'),
        meta: {
          columnChooserGroup: 'Associations',
          filterable: false,
          filterGroup: 'CRM',
          filterIconName: 'user-round',
          maxWidth: '220px',
          tooltipContent: (row: DealRow) =>
            normalizeCollectionLabels(
              row.people.map((entry) => (entry.label && entry.label.trim().length ? entry.label : t('customers.deals.list.unnamedPerson'))),
            ).join(', '),
        },
        cell: ({ row }) => {
          const people = row.original.people
          if (!people.length) return noValue
          const labels = normalizeCollectionLabels(
            people.map((person) =>
              person.label && person.label.trim().length ? person.label : t('customers.deals.list.unnamedPerson')),
          )
          const tooltip = labels.join(', ')
          return (
            <SimpleTooltip content={tooltip} side="top">
              <span className="inline-flex">
                <AvatarStack max={4} size="sm">
                  {people.map((person) => (
                    <Avatar
                      key={person.id}
                      label={person.label || t('customers.deals.list.unnamedPerson')}
                      size="sm"
                    />
                  ))}
                </AvatarStack>
              </span>
            </SimpleTooltip>
          )
        },
      },
      {
        accessorKey: 'updatedAt',
        header: t('customers.deals.list.columns.updatedAt'),
        meta: {
          columnChooserGroup: 'Dates',
          filterKey: 'updated_at',
          filterGroup: 'Activity',
          filterIconName: 'calendar',
        },
        cell: ({ row }) => (
          <span className="text-sm">
            {formatDateValue(row.original.updatedAt ?? null, t('customers.deals.list.noValue'))}
          </span>
        ),
      },
      ...customColumns,
    ]
  }, [customFieldDefs, dictionaryMaps, dictionaryOptions, isDealOverdue, loadOwnerFilterOptions, ownerNames, pipelineNames, resolvedOwnerFilterOptions, t])

  const { advancedFilterFields } = useAutoDiscoveredFields({ columns, customFieldDefs })

  // Sync auto-discovered fields into the `filterPanel` declared at the top of
  // the component. See the comment on the `panelFields` state for why this
  // late-binding is safe. Bail out by content (field-key list) — every render
  // of `useAutoDiscoveredFields` produces fresh `FilterFieldDef` object refs
  // even when the set of fields hasn't actually changed, so a naive reference
  // setState would loop ("Maximum update depth exceeded").
  React.useEffect(() => {
    setPanelFields((prev) => {
      if (prev === advancedFilterFields) return prev
      if (prev.length === advancedFilterFields.length) {
        let same = true
        for (let i = 0; i < prev.length; i++) {
          if (prev[i].key !== advancedFilterFields[i].key) { same = false; break }
        }
        if (same) return prev
      }
      return advancedFilterFields
    })
  }, [advancedFilterFields])

  const associationFilterFields = React.useMemo<FilterFieldDef[]>(() => {
    const personLabels = new Map<string, string>()
    const companyLabels = new Map<string, string>()
    for (const row of rows) {
      for (const person of row.people) {
        if (selectedPersonIds.includes(person.id) && person.label.trim().length > 0) {
          personLabels.set(person.id, person.label)
        }
      }
      for (const company of row.companies) {
        if (selectedCompanyIds.includes(company.id) && company.label.trim().length > 0) {
          companyLabels.set(company.id, company.label)
        }
      }
    }
    return [
      {
        key: 'people',
        label: t('customers.deals.list.columns.people', 'People'),
        type: 'select',
        options: selectedPersonIds.map((id) => ({ value: id, label: personLabels.get(id) ?? id })),
      },
      {
        key: 'companies',
        label: t('customers.deals.list.columns.companies', 'Companies'),
        type: 'select',
        options: selectedCompanyIds.map((id) => ({ value: id, label: companyLabels.get(id) ?? id })),
      },
    ]
  }, [rows, selectedCompanyIds, selectedPersonIds, t])
  const associationFilterTree = React.useMemo<AdvancedFilterTree>(() => {
    const rules: Array<{ field: string; operator: 'is_any_of'; value: string[] }> = []
    if (selectedPersonIds.length) rules.push({ field: 'people', operator: 'is_any_of', value: selectedPersonIds })
    if (selectedCompanyIds.length) rules.push({ field: 'companies', operator: 'is_any_of', value: selectedCompanyIds })
    return rules.length ? makeMultiRuleTree(rules) : createEmptyTree()
  }, [selectedCompanyIds, selectedPersonIds])
  const handleAssociationFilterRemove = React.useCallback((nodeId: string) => {
    const node = associationFilterTree.root.children.find((child) => child.id === nodeId)
    if (!node || node.type !== 'rule') return
    if (node.field === 'people') setSelectedPersonIds([])
    if (node.field === 'companies') setSelectedCompanyIds([])
    setPage(1)
  }, [associationFilterTree.root.children])

  const dealsPresets = React.useMemo<FilterPreset[]>(() => makeDealsPresets(), [])

  return (
    <Page>
      <PageBody>
        <ViewTabsRow active="list" className="mb-4" />
        <DealsKpiStrip
          ownerNames={ownerNames}
          stageDictionary={dictionaryMaps['pipeline-stages'] ?? {}}
          pipelineCount={Object.keys(pipelineNames).length}
          scopeVersion={scopeVersion}
          reloadToken={reloadToken}
          onNeedsAttentionClick={handleNeedsAttentionFilter}
          className="mb-4"
        />
        <DataTable<DealRow>
          stickyFirstColumn
          stickyActionsColumn
          actionsColumnAlign="center"
          title={t('customers.deals.list.title')}
          actions={(
            <Button asChild>
              <Link href="/backend/customers/deals/create">
                {t('customers.deals.list.actions.new', 'New deal')}
              </Link>
            </Button>
          )}
          columns={columns}
          columnChooser={{ auto: true }}
          data={rows}
          onRowClick={(row) => {
            router.push(`/backend/customers/deals/${row.id}`)
          }}
          rowActions={(row) => {
            const isDeleting = pendingDeleteId === row.id
            return (
              <RowActions
                items={[
                  {
                    id: 'edit',
                    label: t('customers.deals.list.actions.edit', 'Edit'),
                    onSelect: () => { router.push(`/backend/customers/deals/${row.id}`) },
                  },
                  {
                    id: 'open-new-tab',
                    label: t('customers.deals.list.actions.openInNewTab', 'Open in new tab'),
                    onSelect: () => {
                      if (typeof window !== 'undefined') {
                        window.open(`/backend/customers/deals/${row.id}`, '_blank', 'noopener')
                      }
                    },
                  },
                  {
                    id: 'delete',
                    label: isDeleting
                      ? t('customers.deals.list.actions.deleting', 'Deleting…')
                      : t('customers.deals.list.actions.delete', 'Delete'),
                    destructive: true,
                    onSelect: () => handleDeleteDeal(row.id),
                  },
                ]}
              />
            )
          }}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          bulkActions={[
            {
              id: 'delete',
              label: t('customers.deals.list.actions.delete', 'Delete'),
              destructive: true,
              onExecute: handleBulkDelete,
            },
          ]}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('customers.deals.list.searchPlaceholder')}
          pagination={{
            page,
            pageSize,
            total,
            totalPages,
            onPageChange: (nextPage) => setPage(nextPage),
            pageSizeOptions: [10, 25, 50, 100],
            onPageSizeChange: handlePageSizeChange,
            cacheStatus,
          }}
          isLoading={isLoading}
          refreshButton={{
            label: t('customers.deals.list.refresh'),
            onRefresh: handleRefresh,
          }}
          exporter={exportConfig}
          entityId={E.customers.customer_deal}
          perspective={{ tableId: 'customers.deals.list' }}
          advancedFilter={{
            auto: true,
            value: filterPanel.tree,
            onChange: filterPanel.setTree,
            onApply: () => filterPanel.flush(),
            onClear: handleAdvancedFilterClear,
            triggerRef: filtersTriggerRef,
            externalPopover: true,
            onTriggerClick: () => setFiltersOpen((prev) => !prev),
            onApplyTree: (tree) => {
              filterPanel.replaceTree(tree)
              setPage(1)
            },
          }}
          activeFilterChips={(
            <>
              {needsAttentionOnly ? (
                <div
                  className="flex items-center gap-2 overflow-x-auto border-b border-border bg-background px-4 py-2"
                  data-testid="active-filter-chips"
                >
                  <div
                    className="inline-flex items-center gap-1"
                    data-testid="active-filter-chip"
                    aria-label={t('customers.deals.list.filters.needsAttention')}
                  >
                    <Tag variant="warning" dot>{t('customers.deals.list.filters.needsAttention')}</Tag>
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={t('customers.deals.list.filters.needsAttentionRemove')}
                      onClick={handleNeedsAttentionClear}
                    >
                      <X className="size-3" />
                    </IconButton>
                  </div>
                </div>
              ) : null}
              <ActiveFilterChips
                tree={associationFilterTree}
                fields={associationFilterFields}
                popoverOpen={filtersOpen}
                onRemoveNode={handleAssociationFilterRemove}
                onOpen={() => setFiltersOpen(true)}
              />
              <ActiveFilterChips
                tree={filterPanel.appliedTree}
                fields={advancedFilterFields}
                popoverOpen={filtersOpen}
                onRemoveNode={(id) => filterPanel.dispatch({ type: 'removeNode', nodeId: id })}
                onOpen={() => setFiltersOpen(true)}
              />
            </>
          )}
          filterAwareEmptyState={{
            active: needsAttentionOnly || associationFilterTree.root.children.length > 0 || advancedFilterState.root.children.length > 0,
            entityNamePlural: t('customers.deals.entityPlural', 'deals'),
            canRemoveLast: needsAttentionOnly || associationFilterTree.root.children.length > 0 || filterPanel.tree.root.children.length > 0,
            onClearAll: () => {
              handleAdvancedFilterClear()
              setSelectedPersonIds([])
              setSelectedCompanyIds([])
              setNeedsAttentionOnly(false)
            },
            onRemoveLast: () => {
              if (needsAttentionOnly) {
                handleNeedsAttentionClear()
                return
              }
              if (selectedCompanyIds.length > 0) {
                setSelectedCompanyIds([])
                setPage(1)
                return
              }
              if (selectedPersonIds.length > 0) {
                setSelectedPersonIds([])
                setPage(1)
                return
              }
              filterPanel.dispatch({ type: 'removeLast' })
            },
          }}
          emptyState={(
            <ListEmptyState
              entityName={t('customers.deals.entityPlural', 'deals')}
              createHref="/backend/customers/deals/create"
              createLabel={t('customers.deals.list.actions.new', 'New deal')}
            />
          )}
          virtualized
        />
        <AdvancedFilterPanel
          fields={advancedFilterFields}
          value={filterPanel.tree}
          onChange={filterPanel.setTree}
          onApply={filterPanel.flush}
          onClear={handleAdvancedFilterClear}
          onFlush={filterPanel.flush}
          pendingErrors={filterPanel.pendingErrors}
          userId={currentUserId}
          presets={dealsPresets}
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          triggerRef={filtersTriggerRef}
          savedFilterStorageKey="customers.deals.list"
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}

function mapDeal(item: Record<string, unknown>): DealRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const title = typeof item.title === 'string' ? item.title : ''
  const status = typeof item.status === 'string' ? item.status : null
  const pipelineStage = typeof item.pipeline_stage === 'string' ? item.pipeline_stage : null
  const pipelineStageId = typeof item.pipeline_stage_id === 'string' ? item.pipeline_stage_id : null
  const pipelineId = typeof item.pipeline_id === 'string' ? item.pipeline_id : null
  const valueAmountRaw = item.value_amount
  const valueAmount =
    typeof valueAmountRaw === 'number'
      ? valueAmountRaw
      : typeof valueAmountRaw === 'string' && valueAmountRaw.trim()
        ? Number(valueAmountRaw)
        : null
  const valueCurrency =
    typeof item.value_currency === 'string' && item.value_currency.trim().length
      ? item.value_currency.trim().toUpperCase()
      : null
  const probabilityRaw = item.probability
  const probability =
    typeof probabilityRaw === 'number'
      ? probabilityRaw
      : typeof probabilityRaw === 'string' && probabilityRaw.trim().length
        ? Number(probabilityRaw)
        : null
  const expectedCloseAt = typeof item.expected_close_at === 'string' ? item.expected_close_at : null
  const updatedAt = typeof item.updated_at === 'string' ? item.updated_at : null
  const ownerUserId = typeof item.owner_user_id === 'string' ? item.owner_user_id : null
  const peopleRaw = Array.isArray(item.people) ? item.people : []
  const companiesRaw = Array.isArray(item.companies) ? item.companies : []
  const people = peopleRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const data = entry as Record<string, unknown>
      const pid = typeof data.id === 'string' ? data.id : null
      if (!pid) return null
      const label = typeof data.label === 'string' ? data.label : ''
      return { id: pid, label }
    })
    .filter((entry): entry is { id: string; label: string } => !!entry)
  const companies = companiesRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const data = entry as Record<string, unknown>
      const cid = typeof data.id === 'string' ? data.id : null
      if (!cid) return null
      const label = typeof data.label === 'string' ? data.label : ''
      return { id: cid, label }
    })
    .filter((entry): entry is { id: string; label: string } => !!entry)
  const customFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key.startsWith('cf_')) customFields[key] = value
  }
  return withDataTableNamespaces({
    id,
    title,
    status,
    pipelineStage,
    pipelineStageId,
    pipelineId,
    valueAmount,
    valueCurrency,
    probability,
    expectedCloseAt,
    updatedAt,
    ownerUserId,
    people,
    companies,
    ...customFields,
  }, item)
}
