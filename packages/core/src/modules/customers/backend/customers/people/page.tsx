"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type DataTableExportFormat, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildCrudExportUrl } from '@open-mercato/ui/backend/utils/crud'
import { groupBulkDeleteFailures, runBulkDelete } from '@open-mercato/ui/backend/utils/bulkDelete'
import { coalesceLastOperations } from '@open-mercato/ui/backend/operations/store'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { E } from '#generated/entities.ids.generated'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { FilterOption } from '@open-mercato/ui/backend/FilterOverlay'
import type { FilterFieldDef, FilterOption as AdvancedFilterOption } from '@open-mercato/shared/lib/query/advanced-filter'
import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { createEmptyTree, makeRuleTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { deserializeAdvancedFilter, deserializeTree, flatToTree, mapDictionaryColorToTone, serializeTree } from '@open-mercato/shared/lib/query/advanced-filter'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import {
  DictionaryValue,
  createEmptyCustomerDictionaryMaps,
  renderDictionaryColor,
  renderDictionaryIcon,
  type CustomerDictionaryKind,
  type CustomerDictionaryMap,
} from '../../../lib/dictionaries'
import {
  useCustomFieldDefs,
} from '@open-mercato/ui/backend/utils/customFieldDefs'
import {
  mapCustomFieldKindToFilterType,
  normalizeCustomFieldFilterOptions,
  supportsCustomFieldColumn,
} from '@open-mercato/ui/backend/utils/customFieldColumns'
import { useAutoDiscoveredFields } from '@open-mercato/ui/backend/utils/useAutoDiscoveredFields'
import { useAdvancedFilterTree } from '@open-mercato/ui/backend/hooks/useAdvancedFilter'
import { AdvancedFilterPanel } from '@open-mercato/ui/backend/filters/AdvancedFilterPanel'
import { ActiveFilterChips } from '@open-mercato/ui/backend/filters/ActiveFilterChips'
import type { FilterPreset } from '@open-mercato/ui/backend/filters/QuickFilters'
import { useQueryClient } from '@tanstack/react-query'
import { ensureCustomerDictionary } from '../../../components/detail/hooks/useCustomerDictionary'
import {
  ensureCurrentUserFilterOption,
  fetchAssignableStaffMembers,
  mapAssignableStaffToFilterOptions,
} from '../../../components/detail/assignableStaff'
import { CollectionPreviewCell, normalizeCollectionLabels } from '../../../components/list/CollectionPreviewCell'

type DictionaryOptionWithTone = AdvancedFilterOption & FilterOption

function makePeoplePresets(): FilterPreset[] {
  return [
    {
      id: 'recently-active',
      labelKey: 'customers.people.presets.recentlyActive',
      iconName: 'clock',
      build: ({ now }) => {
        const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
        return makeRuleTree({ field: 'next_interaction_at', operator: 'is_after', value: cutoff })
      },
    },
    {
      id: 'my-contacts',
      labelKey: 'customers.people.presets.myContacts',
      requiresUser: true,
      build: ({ userId }) => makeRuleTree({ field: 'owner_user_id', operator: 'is', value: userId }),
    },
    {
      id: 'hot-leads',
      labelKey: 'customers.people.presets.hotLeads',
      build: () => makeRuleTree({ field: 'lifecycle_stage', operator: 'is', value: 'lead' }),
    },
    {
      id: 'stale-30',
      labelKey: 'customers.people.presets.stale30',
      build: ({ now }) => {
        const cutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
        return makeRuleTree({ field: 'next_interaction_at', operator: 'is_before', value: cutoff })
      },
    },
  ]
}

type PersonRow = {
  id: string
  name: string
  description?: string | null
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  preferredName?: string | null
  jobTitle?: string | null
  department?: string | null
  seniority?: string | null
  timezone?: string | null
  linkedInUrl?: string | null
  twitterUrl?: string | null
  companyEntityId?: string | null
  status?: string | null
  lifecycleStage?: string | null
  nextInteractionAt?: string | null
  nextInteractionName?: string | null
  nextInteractionIcon?: string | null
  nextInteractionColor?: string | null
  organizationId?: string | null
  source?: string | null
  ownerUserId?: string | null
} & Record<string, unknown>

type PeopleResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  totalPages?: number
}

type DictionaryKindKey = CustomerDictionaryKind
type DictionaryMap = CustomerDictionaryMap

const NO_MATCH_TAG_SENTINEL = '__no_match__'

function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString()
}

function mapApiItem(item: Record<string, unknown>): PersonRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const name = typeof item.display_name === 'string' ? item.display_name : ''
  const description = typeof item.description === 'string' ? item.description : null
  const email = typeof item.primary_email === 'string' ? item.primary_email : null
  const phone = typeof item.primary_phone === 'string' ? item.primary_phone : null
  const firstName = typeof item.first_name === 'string' ? item.first_name : null
  const lastName = typeof item.last_name === 'string' ? item.last_name : null
  const preferredName = typeof item.preferred_name === 'string' ? item.preferred_name : null
  const jobTitle = typeof item.job_title === 'string' ? item.job_title : null
  const department = typeof item.department === 'string' ? item.department : null
  const seniority = typeof item.seniority === 'string' ? item.seniority : null
  const timezone = typeof item.timezone === 'string' ? item.timezone : null
  const linkedInUrl = typeof item.linked_in_url === 'string' ? item.linked_in_url : null
  const twitterUrl = typeof item.twitter_url === 'string' ? item.twitter_url : null
  const companyEntityId = typeof item.company_entity_id === 'string' ? item.company_entity_id : null
  const status = typeof item.status === 'string' ? item.status : null
  const lifecycleStage = typeof item.lifecycle_stage === 'string' ? item.lifecycle_stage : null
  const nextInteractionAt = typeof item.next_interaction_at === 'string' ? item.next_interaction_at : null
  const nextInteractionName = typeof item.next_interaction_name === 'string' ? item.next_interaction_name : null
  const nextInteractionIcon = typeof item.next_interaction_icon === 'string' ? item.next_interaction_icon : null
  const nextInteractionColor = typeof item.next_interaction_color === 'string' ? item.next_interaction_color : null
  const organizationId = typeof item.organization_id === 'string' ? item.organization_id : null
  const source = typeof item.source === 'string' ? item.source : null
  const customFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key.startsWith('cf_')) {
      customFields[key] = value
    }
  }
  return withDataTableNamespaces({
    id,
    name,
    description,
    email,
    phone,
    firstName,
    lastName,
    preferredName,
    jobTitle,
    department,
    seniority,
    timezone,
    linkedInUrl,
    twitterUrl,
    companyEntityId,
    status,
    lifecycleStage,
    nextInteractionAt,
    nextInteractionName,
    nextInteractionIcon,
    nextInteractionColor,
    organizationId,
    source,
    ...customFields,
  }, item)
}

export default function CustomersPeoplePage() {
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<PersonRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [sorting, setSorting] = React.useState<import('@tanstack/react-table').SortingState>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const pathname = usePathname()
  const searchParams = useSearchParams()
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
    // searchParams is intentionally evaluated once on mount — subsequent URL
    // changes flow through the hook, not back through hydration.
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
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [cacheStatus, setCacheStatus] = React.useState<'hit' | 'miss' | null>(null)
  const [dictionaryMaps, setDictionaryMaps] = React.useState<Record<DictionaryKindKey, DictionaryMap>>(createEmptyCustomerDictionaryMaps())
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()
  const t = useT()
  const router = useRouter()
  const handlePageSizeChange = React.useCallback((newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }, [])

  const bulkMutationContextId = 'customers-people-list:bulk-delete'
  const { runMutation: runBulkMutation, retryLastMutation: retryBulkMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: bulkMutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const singleMutationContextId = 'customers-people-list:single-delete'
  const { runMutation: runSingleMutation, retryLastMutation: retrySingleMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: singleMutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const fetchDictionaryEntries = React.useCallback(async (kind: DictionaryKindKey) => {
    try {
      const data = await ensureCustomerDictionary(queryClient, kind, scopeVersion)
      setDictionaryMaps((prev) => ({
        ...prev,
        [kind]: data.map,
      }))
      return data.entries
    } catch {
      return []
    }
  }, [queryClient, scopeVersion])
  const dictionaryOptions = React.useMemo(() => {
    const toOptions = (map?: DictionaryMap | null): DictionaryOptionWithTone[] =>
      Object.values(map ?? {})
        .map((entry) => {
          const tone = mapDictionaryColorToTone(entry.color)
          const option: DictionaryOptionWithTone = { value: entry.value, label: entry.label }
          if (tone) option.tone = tone
          return option
        })
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    return {
      statuses: toOptions(dictionaryMaps.statuses),
      sources: toOptions(dictionaryMaps.sources),
      lifecycleStages: toOptions(dictionaryMaps['lifecycle-stages']),
    }
  }, [dictionaryMaps])

  React.useEffect(() => {
    let cancelled = false
    async function loadAll() {
      if (cancelled) return
      setDictionaryMaps(createEmptyCustomerDictionaryMaps())
      await Promise.all([
        fetchDictionaryEntries('statuses'),
        fetchDictionaryEntries('sources'),
        fetchDictionaryEntries('lifecycle-stages'),
      ])
    }
    loadAll().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [fetchDictionaryEntries, scopeVersion, reloadToken])

  const { data: customFieldDefs = [] } = useCustomFieldDefs(
    [E.customers.customer_entity, E.customers.customer_person_profile],
    { keyExtras: [scopeVersion, reloadToken] },
  )
  const currentUserId = useCurrentUserId()
  const [ownerFilterOptions, setOwnerFilterOptions] = React.useState<AdvancedFilterOption[]>([])
  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    void fetchAssignableStaffMembers('', { pageSize: 100, signal: controller.signal })
      .then((items) => {
        if (!cancelled) setOwnerFilterOptions(mapAssignableStaffToFilterOptions(items))
      })
      .catch(() => {
        if (!cancelled) setOwnerFilterOptions([])
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

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (sorting.length > 0) {
      params.set('sort', sorting[0].id)
      params.set('order', sorting[0].desc ? 'desc' : 'asc')
    }
    if (search.trim()) params.set('search', search.trim())
    const advancedParams = serializeTree(advancedFilterState)
    for (const [key, val] of Object.entries(advancedParams)) {
      params.set(key, val)
    }
    return params.toString()
  }, [advancedFilterState, page, pageSize, search, sorting])

  const currentParams = React.useMemo(() => Object.fromEntries(new URLSearchParams(queryParams)), [queryParams])

  // Mirror page state into the URL so a refresh restores the same filter tree,
  // including nested subgroups. Without this effect the People page would
  // discard everything the user typed into the filter panel on refresh
  // (the previous behavior — top-level rules only "appeared" to survive
  // because a stale localStorage perspective snapshot was being re-applied).
  const queryRef = React.useRef(searchParams?.toString() ?? '')
  React.useEffect(() => {
    if (!pathname) return
    const params = new URLSearchParams()
    if (search.trim().length) params.set('search', search.trim())
    if (page > 1) params.set('page', String(page))
    if (sorting.length > 0) {
      params.set('sort', sorting[0].id)
      params.set('order', sorting[0].desc ? 'desc' : 'asc')
    }
    const advancedParams = serializeTree(advancedFilterState)
    for (const [key, val] of Object.entries(advancedParams)) {
      params.set(key, val)
    }
    const next = params.toString()
    if (queryRef.current === next) return
    queryRef.current = next
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
  }, [pathname, router, page, search, sorting, advancedFilterState])

  const exportConfig = React.useMemo(() => ({
    view: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('customers/people', { ...currentParams, exportScope: 'view' }, format),
    },
    full: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('customers/people', { ...currentParams, exportScope: 'full', all: 'true' }, format),
    },
  }), [currentParams])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setCacheStatus(null)
      try {
        const fallback: PeopleResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<PeopleResponse>(`/api/customers/people?${queryParams}`, undefined, { fallback })
        if (!call.ok) {
          const errorPayload = call.result as { error?: string } | undefined
          const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('customers.people.list.error.load')
          flash(message, 'error')
          if (!cancelled) setCacheStatus(null)
          return
        }
        const payload = call.result ?? fallback
        if (cancelled) return
        setCacheStatus(call.cacheStatus ?? null)
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items.map((item) => mapApiItem(item as Record<string, unknown>)).filter((row): row is PersonRow => !!row))
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (!cancelled) {
          setCacheStatus(null)
          const message = err instanceof Error ? err.message : t('customers.people.list.error.load')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [queryParams, reloadToken, scopeVersion, t])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (person: PersonRow) => {
    if (!person?.id) return
    const name = person.name || t('customers.people.list.deleteFallbackName')
    const confirmed = await confirm({
      title: t('customers.people.list.deleteConfirm', undefined, { name }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runSingleMutation({
        operation: async () => {
          await apiCallOrThrow(
            `/api/customers/people?id=${encodeURIComponent(person.id)}`,
            {
              method: 'DELETE',
              headers: { 'content-type': 'application/json' },
            },
            { errorMessage: t('customers.people.list.deleteError') },
          )
        },
        context: {
          formId: singleMutationContextId,
          resourceKind: 'customers.person',
          resourceId: person.id,
          retryLastMutation: retrySingleMutation,
        },
      })
      setRows((prev) => prev.filter((row) => row.id !== person.id))
      setTotal((prev) => Math.max(prev - 1, 0))
      handleRefresh()
      flash(t('customers.people.list.deleteSuccess'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.list.deleteError')
      flash(message, 'error')
    }
  }, [confirm, handleRefresh, retrySingleMutation, runSingleMutation, singleMutationContextId, t])

  const handleBulkDelete = React.useCallback(async (selectedRows: PersonRow[]) => {
    const confirmed = await confirm({
      title: t('customers.people.list.bulkDelete.title', 'Delete {count} people?', { count: selectedRows.length }),
      description: t('customers.people.list.bulkDelete.description', 'This action cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return false

    const { succeeded, failures } = await runBulkMutation({
      operation: async () =>
        runBulkDelete(
          selectedRows,
          async (row) => {
            await apiCallOrThrow(`/api/customers/people?id=${encodeURIComponent(row.id)}`, {
              method: 'DELETE',
              headers: { 'content-type': 'application/json' },
            })
          },
          {
            fallbackErrorMessage: t('customers.people.list.deleteError', 'Failed to delete person.'),
            logTag: 'customers.people.list',
            progress: {
              jobType: 'customers.people.bulk_delete',
              name: t('customers.people.list.bulkDelete.progressName', 'Delete selected people'),
              description: t(
                'customers.people.list.bulkDelete.progressDescription',
                '{count} people selected for deletion',
                { count: selectedRows.length },
              ),
              meta: { source: 'customers.people.list' },
            },
          },
        ),
      context: {
        formId: bulkMutationContextId,
        resourceKind: 'customers.person',
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
          commandId: 'customers.people.delete',
          actionLabel: t('customers.people.list.bulkDelete.operationLabel', 'Delete {count} people', { count: succeeded.length }),
          resourceKind: 'customers.person',
        })
      }
      if (failures.length === 0) {
        flash(
          t('customers.people.list.bulkDelete.success', '{count} people deleted', { count: succeeded.length }),
          'success',
        )
      } else {
        flash(
          t('customers.people.list.bulkDelete.partial', '{deleted} of {total} people deleted; {failed} failed', {
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
            'customers.people.list.bulkDelete.failedGroup',
            '{count} people could not be deleted: {message}',
            { count: group.count, message: group.sampleMessage },
          )
      flash(message, 'error')
    }

    return succeeded.length > 0
  }, [bulkMutationContextId, confirm, retryBulkMutation, runBulkMutation, t])

  const columns = React.useMemo<ColumnDef<PersonRow>[]>(() => {
    const noValue = <span className="text-muted-foreground text-sm">{t('customers.people.list.noValue')}</span>
    const renderDictionaryCell = (kind: DictionaryKindKey, rawValue: string | null | undefined) => (
      <DictionaryValue
        value={rawValue}
        map={dictionaryMaps[kind]}
        fallback={rawValue ? <span>{rawValue}</span> : noValue}
        className="text-sm"
        iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card"
        iconClassName="h-4 w-4"
        colorClassName="h-3 w-3 rounded-full"
      />
    )

    const renderCustomFieldCell = (value: unknown) => {
      if (value == null) return noValue
      if (Array.isArray(value)) {
        if (!value.length) return noValue
        const normalized = normalizeCollectionLabels(
          value.map((item) => {
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
              ? t('customers.people.list.booleanYes', 'Yes')
              : t('customers.people.list.booleanNo', 'No')}
          </span>
        )
      }
      const stringValue = typeof value === 'string' ? value.trim() : String(value)
      if (!stringValue) return noValue
      return <span className="text-sm">{stringValue}</span>
    }

    const baseColumns: ColumnDef<PersonRow>[] = [
      {
        accessorKey: 'name',
        header: t('customers.people.list.columns.name'),
        meta: {
          alwaysVisible: true,
          columnChooserGroup: 'Basic Info',
          filterKey: 'display_name',
          filterGroup: 'CRM',
          maxWidth: '240px',
        },
        cell: ({ row }) => (
          <Link href={`/backend/customers/people-v2/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'email',
        header: t('customers.people.list.columns.email'),
        meta: {
          columnChooserGroup: 'Contact',
          filterKey: 'primary_email',
          filterGroup: 'Contact',
          filterIconName: 'mail',
          maxWidth: '220px',
        },
        cell: ({ row }) => row.original.email || <span className="text-muted-foreground text-sm">{t('customers.people.list.noValue')}</span>,
      },
      {
        accessorKey: 'status',
        header: t('customers.people.list.columns.status'),
        meta: {
          filterType: 'select' as const,
          filterOptions: dictionaryOptions.statuses,
          columnChooserGroup: 'Basic Info',
          filterGroup: 'CRM',
        },
        cell: ({ row }) => renderDictionaryCell('statuses', row.original.status),
      },
      {
        accessorKey: 'lifecycleStage',
        header: t('customers.people.list.columns.lifecycleStage'),
        meta: {
          filterType: 'select' as const,
          filterOptions: dictionaryOptions.lifecycleStages,
          columnChooserGroup: 'Basic Info',
          filterKey: 'lifecycle_stage',
          filterGroup: 'CRM',
        },
        cell: ({ row }) => renderDictionaryCell('lifecycle-stages', row.original.lifecycleStage),
      },
      {
        accessorKey: 'nextInteractionAt',
        header: t('customers.people.list.columns.nextInteraction'),
        meta: {
          columnChooserGroup: 'Dates',
          filterKey: 'next_interaction_at',
          filterGroup: 'Activity',
          filterIconName: 'calendar',
          tooltipContent: (row: PersonRow) => {
            if (!row.nextInteractionAt) return undefined
            const date = formatDate(row.nextInteractionAt, '')
            const name = row.nextInteractionName || ''
            return [date, name].filter(Boolean).join(' - ')
          },
        },
        cell: ({ row }) =>
          row.original.nextInteractionAt
            ? (
              <div className="flex items-start gap-2 text-sm">
                {row.original.nextInteractionIcon ? (
                  <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card">
                    {renderDictionaryIcon(row.original.nextInteractionIcon, 'h-4 w-4')}
                  </span>
                ) : null}
                <div className="flex flex-col">
                  <span>{formatDate(row.original.nextInteractionAt, t('customers.people.list.noValue'))}</span>
                  {row.original.nextInteractionName ? (
                    <span className="text-xs text-muted-foreground">{row.original.nextInteractionName}</span>
                  ) : null}
                </div>
                {row.original.nextInteractionColor ? (
                  <span className="mt-1">
                    {renderDictionaryColor(row.original.nextInteractionColor, 'h-3 w-3 rounded-full border border-border')}
                  </span>
                ) : null}
              </div>
            )
            : <span className="text-muted-foreground text-sm">{t('customers.people.list.noValue')}</span>,
      },
      {
        accessorKey: 'source',
        header: t('customers.people.list.columns.source'),
        meta: {
          filterType: 'select' as const,
          filterOptions: dictionaryOptions.sources,
          columnChooserGroup: 'Basic Info',
          filterGroup: 'CRM',
        },
        cell: ({ row }) => renderDictionaryCell('sources', row.original.source),
      },
      {
        accessorKey: 'ownerUserId',
        header: t('customers.people.list.columns.owner', 'Owner'),
        meta: {
          columnChooserGroup: 'CRM',
          filterType: 'select',
          filterOptions: resolvedOwnerFilterOptions,
          filterLoadOptions: loadOwnerFilterOptions,
          filterGroup: 'CRM',
          filterIconName: 'user-round',
          filterKey: 'owner_user_id',
          hidden: true,
        },
        cell: ({ row }) => row.original.ownerUserId ?? null,
      },
      {
        accessorKey: 'firstName',
        header: t('customers.people.form.firstName', 'First name'),
        meta: {
          columnChooserGroup: 'Profile',
          hidden: true,
          filterKey: 'person_profile.first_name',
          filterGroup: 'Profile',
        },
        cell: ({ row }) => row.original.firstName || noValue,
      },
      {
        accessorKey: 'lastName',
        header: t('customers.people.form.lastName', 'Last name'),
        meta: {
          columnChooserGroup: 'Profile',
          hidden: true,
          filterKey: 'person_profile.last_name',
          filterGroup: 'Profile',
        },
        cell: ({ row }) => row.original.lastName || noValue,
      },
      {
        accessorKey: 'preferredName',
        header: t('customers.people.form.preferredName', 'Preferred name'),
        meta: {
          columnChooserGroup: 'Profile',
          hidden: true,
          filterKey: 'person_profile.preferred_name',
          filterGroup: 'Profile',
        },
        cell: ({ row }) => row.original.preferredName || noValue,
      },
      {
        accessorKey: 'jobTitle',
        header: t('customers.people.form.jobTitle', 'Job title'),
        meta: {
          columnChooserGroup: 'Profile',
          hidden: true,
          filterKey: 'person_profile.job_title',
          filterGroup: 'Profile',
        },
        cell: ({ row }) => row.original.jobTitle || noValue,
      },
      {
        accessorKey: 'department',
        header: t('customers.people.detail.fields.department', 'Department'),
        meta: {
          columnChooserGroup: 'Profile',
          hidden: true,
          filterKey: 'person_profile.department',
          filterGroup: 'Profile',
        },
        cell: ({ row }) => row.original.department || noValue,
      },
      {
        accessorKey: 'seniority',
        header: t('customers.people.detail.fields.seniority', 'Seniority'),
        meta: {
          columnChooserGroup: 'Profile',
          hidden: true,
          filterKey: 'person_profile.seniority',
          filterGroup: 'Profile',
        },
        cell: ({ row }) => row.original.seniority || noValue,
      },
      {
        accessorKey: 'timezone',
        header: t('customers.people.detail.fields.timezone', 'Timezone'),
        meta: {
          columnChooserGroup: 'Profile',
          hidden: true,
          filterKey: 'person_profile.timezone',
          filterGroup: 'Profile',
        },
        cell: ({ row }) => row.original.timezone || noValue,
      },
      {
        accessorKey: 'linkedInUrl',
        header: t('customers.people.detail.fields.linkedIn', 'LinkedIn'),
        meta: {
          columnChooserGroup: 'Socials',
          hidden: true,
          filterKey: 'person_profile.linked_in_url',
          filterGroup: 'Socials',
        },
        cell: ({ row }) => row.original.linkedInUrl || noValue,
      },
      {
        accessorKey: 'twitterUrl',
        header: t('customers.people.detail.fields.twitter', 'Twitter'),
        meta: {
          columnChooserGroup: 'Socials',
          hidden: true,
          filterKey: 'person_profile.twitter_url',
          filterGroup: 'Socials',
        },
        cell: ({ row }) => row.original.twitterUrl || noValue,
      },
      {
        accessorKey: 'description',
        header: t('customers.people.form.description', 'Description'),
        meta: {
          columnChooserGroup: 'Notes',
          hidden: true,
          filterKey: 'description',
          filterGroup: 'Notes',
        },
        cell: ({ row }) => row.original.description || noValue,
      },
    ]

    const customColumns = customFieldDefs
      .filter((def) => supportsCustomFieldColumn(def))
      .map<ColumnDef<PersonRow>>((def) => ({
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
        cell: ({ getValue }) => renderCustomFieldCell(getValue()),
      }))

    return [...baseColumns, ...customColumns]
  }, [customFieldDefs, dictionaryMaps, dictionaryOptions, loadOwnerFilterOptions, resolvedOwnerFilterOptions, t])

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

  const peoplePresets = React.useMemo<FilterPreset[]>(() => makePeoplePresets(), [])

  return (
    <Page>
      <PageBody>
        <DataTable<PersonRow>
          stickyFirstColumn
          stickyActionsColumn
          title={t('customers.people.list.title')}
          refreshButton={{
            label: t('customers.people.list.actions.refresh'),
            onRefresh: () => { setSearch(''); setPage(1); handleRefresh() },
          }}
          actions={(
            <Button asChild>
              <Link href="/backend/customers/people/create">
                {t('customers.people.list.actions.new')}
              </Link>
            </Button>
          )}
          columns={columns}
          columnChooser={{ auto: true }}
          data={rows}
          exporter={exportConfig}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('customers.people.list.searchPlaceholder')}
          entityIds={[E.customers.customer_entity, E.customers.customer_person_profile]}
          perspective={{ tableId: 'customers.people.list' }}
          onRowClick={(row) => router.push(`/backend/customers/people-v2/${row.id}`)}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          bulkActions={[
            {
              id: 'delete',
              label: t('customers.people.list.bulkDelete.action', 'Delete selected'),
              destructive: true,
              onExecute: handleBulkDelete,
            },
          ]}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'view',
                  label: t('customers.people.list.actions.view'),
                  onSelect: () => { router.push(`/backend/customers/people-v2/${row.id}`) },
                },
                {
                  id: 'open-new-tab',
                  label: t('customers.people.list.actions.openInNewTab'),
                  onSelect: () => window.open(`/backend/customers/people-v2/${row.id}`, '_blank', 'noopener'),
                },
                {
                  id: 'delete',
                  label: t('customers.people.list.actions.delete'),
                  destructive: true,
                  onSelect: () => handleDelete(row),
                },
              ]}
            />
          )}
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
            <ActiveFilterChips
              tree={filterPanel.tree}
              fields={advancedFilterFields}
              popoverOpen={filtersOpen}
              onRemoveNode={(id) => filterPanel.dispatch({ type: 'removeNode', nodeId: id })}
              onOpen={() => setFiltersOpen(true)}
            />
          )}
          filterAwareEmptyState={{
            active: advancedFilterState.root.children.length > 0,
            entityNamePlural: t('customers.people.entityPlural', 'people'),
            canRemoveLast: filterPanel.tree.root.children.length > 0,
            onClearAll: handleAdvancedFilterClear,
            onRemoveLast: () => filterPanel.dispatch({ type: 'removeLast' }),
          }}
          virtualized
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage, cacheStatus, pageSizeOptions: [10, 25, 50, 100], onPageSizeChange: handlePageSizeChange }}
          isLoading={isLoading}
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
          presets={peoplePresets}
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          triggerRef={filtersTriggerRef}
          savedFilterStorageKey="customers.people.list"
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
