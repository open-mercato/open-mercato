"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type DataTableExportFormat, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildCrudExportUrl } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { E } from '#generated/entities.ids.generated'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { FilterOption } from '@open-mercato/ui/backend/FilterOverlay'
import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { createEmptyTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { serializeTree } from '@open-mercato/shared/lib/query/advanced-filter'
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
import { useQueryClient } from '@tanstack/react-query'
import { ensureCustomerDictionary } from '../../../components/detail/hooks/useCustomerDictionary'
import { CollectionPreviewCell, normalizeCollectionLabels } from '../../../components/list/CollectionPreviewCell'

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
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [advancedFilterState, setAdvancedFilterState] = React.useState<AdvancedFilterTree>(() => createEmptyTree())
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [cacheStatus, setCacheStatus] = React.useState<'hit' | 'miss' | null>(null)
  const [dictionaryMaps, setDictionaryMaps] = React.useState<Record<DictionaryKindKey, DictionaryMap>>(createEmptyCustomerDictionaryMaps())
  const [tagIdToLabel, setTagIdToLabel] = React.useState<Record<string, string>>({})
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()
  const t = useT()
  const router = useRouter()
  const handlePageSizeChange = React.useCallback((newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }, [])
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
  const loadDictionaryOptions = React.useCallback(async (kind: 'statuses' | 'sources' | 'lifecycle-stages') => {
    const entries = await fetchDictionaryEntries(kind)
    return entries.map((entry) => ({ value: entry.value, label: entry.label }))
  }, [fetchDictionaryEntries])

  const dictionaryOptions = React.useMemo(() => {
    const toOptions = (map?: DictionaryMap | null): FilterOption[] =>
      Object.values(map ?? {})
        .map((entry) => ({ value: entry.value, label: entry.label }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    return {
      statuses: toOptions(dictionaryMaps.statuses),
      sources: toOptions(dictionaryMaps.sources),
      lifecycleStages: toOptions(dictionaryMaps['lifecycle-stages']),
    }
  }, [dictionaryMaps])

  const loadTagOptions = React.useCallback(async (query?: string): Promise<FilterOption[]> => {
    try {
      const params = new URLSearchParams({ pageSize: '100' })
      const trimmedQuery = typeof query === 'string' ? query.trim() : ''
      if (trimmedQuery) params.set('search', trimmedQuery)
      const payload = await readApiResultOrThrow<{ items?: unknown[] }>(
        `/api/customers/tags?${params.toString()}`,
        undefined,
        { errorMessage: t('customers.people.detail.tags.loadError', 'Failed to load tags.') },
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      const options: FilterOption[] = []
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const raw = item as { id?: unknown; tagId?: unknown; label?: unknown; slug?: unknown }
        const rawId = typeof raw.id === 'string'
          ? raw.id
          : typeof raw.tagId === 'string'
            ? raw.tagId
            : null
        if (!rawId) continue
        const label = typeof raw.label === 'string' && raw.label.trim().length
          ? raw.label.trim()
          : typeof raw.slug === 'string' && raw.slug.trim().length
            ? raw.slug.trim()
            : rawId
        options.push({ value: rawId, label })
      }
      if (options.length) {
        setTagIdToLabel((prev) => {
          let changed = false
          const next = { ...prev }
          for (const option of options) {
            if (next[option.value] !== option.label) {
              next[option.value] = option.label
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
      return options
    } catch (err) {
      console.error('customers.people.list.loadTagOptions', err)
      return []
    }
  }, [setTagIdToLabel, t])

  const tagLabelToId = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const [id, label] of Object.entries(tagIdToLabel)) {
      if (!label) continue
      map[label] = id
    }
    return map
  }, [tagIdToLabel])

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

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('customers.people.list.filters.status'),
      type: 'select',
      options: dictionaryOptions.statuses,
      loadOptions: () => loadDictionaryOptions('statuses'),
    },
    {
      id: 'source',
      label: t('customers.people.list.filters.source'),
      type: 'select',
      options: dictionaryOptions.sources,
      loadOptions: () => loadDictionaryOptions('sources'),
    },
    {
      id: 'lifecycleStage',
      label: t('customers.people.list.filters.lifecycleStage'),
      type: 'select',
      options: dictionaryOptions.lifecycleStages,
      loadOptions: () => loadDictionaryOptions('lifecycle-stages'),
    },
    {
      id: 'tagIds',
      label: t('customers.people.list.filters.tags'),
      type: 'tags',
      loadOptions: loadTagOptions,
      formatValue: (value: string) => tagIdToLabel[value] ?? value,
    },
    {
      id: 'createdAt',
      label: t('customers.people.list.filters.createdAt'),
      type: 'dateRange',
    },
    {
      id: 'emailContains',
      label: t('customers.people.list.filters.emailContains'),
      type: 'text',
      placeholder: t('customers.people.list.filters.emailContainsPlaceholder'),
    },
    {
      id: 'hasEmail',
      label: t('customers.people.list.filters.hasEmail'),
      type: 'checkbox',
    },
    {
      id: 'hasPhone',
      label: t('customers.people.list.filters.hasPhone'),
      type: 'checkbox',
    },
    {
      id: 'hasNextInteraction',
      label: t('customers.people.list.filters.hasNextInteraction'),
      type: 'checkbox',
    },
  ], [dictionaryOptions.lifecycleStages, dictionaryOptions.sources, dictionaryOptions.statuses, loadDictionaryOptions, loadTagOptions, tagIdToLabel, t])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (sorting.length > 0) {
      params.set('sort', sorting[0].id)
      params.set('order', sorting[0].desc ? 'desc' : 'asc')
    }
    if (search.trim()) params.set('search', search.trim())
    const status = filterValues.status
    if (typeof status === 'string' && status.trim()) params.set('status', status)
    const source = filterValues.source
    if (typeof source === 'string' && source.trim()) params.set('source', source)
    const lifecycleStage = filterValues.lifecycleStage
    if (typeof lifecycleStage === 'string' && lifecycleStage.trim()) params.set('lifecycleStage', lifecycleStage)
    const createdAt = filterValues.createdAt
    if (createdAt && typeof createdAt === 'object') {
      if (createdAt.from) params.set('createdFrom', createdAt.from)
      if (createdAt.to) params.set('createdTo', createdAt.to)
    }
    const emailContains = filterValues.emailContains
    if (typeof emailContains === 'string' && emailContains.trim()) {
      params.set('emailContains', emailContains.trim())
    }
    const booleanFilters: Array<['hasEmail' | 'hasPhone' | 'hasNextInteraction', string]> = [
      ['hasEmail', 'hasEmail'],
      ['hasPhone', 'hasPhone'],
      ['hasNextInteraction', 'hasNextInteraction'],
    ]
    for (const [key, queryKey] of booleanFilters) {
      const value = filterValues[key]
      if (value === true) params.set(queryKey, 'true')
      if (value === false) params.set(queryKey, 'false')
    }
    const tagValues = Array.isArray(filterValues.tagIds)
      ? filterValues.tagIds
          .map((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim()))
          .filter((value) => value.length > 0)
      : []
    if (tagValues.length > 0) {
      const normalizedTagIds = tagValues
        .map((value) => (typeof tagIdToLabel[value] === 'string' ? value : tagLabelToId[value]))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (normalizedTagIds.length === tagValues.length && normalizedTagIds.length > 0) {
        params.set('tagIds', normalizedTagIds.join(','))
      } else {
        params.set('tagIdsEmpty', 'true')
      }
    }
    Object.entries(filterValues).forEach(([key, value]) => {
      if (!key.startsWith('cf_') || value == null) return
      if (Array.isArray(value)) {
        const normalized = value
          .map((item) => {
            if (item == null) return ''
            if (typeof item === 'string') return item.trim()
            return String(item).trim()
          })
          .filter((item) => item.length > 0)
        if (normalized.length) params.set(key, normalized.join(','))
      } else if (typeof value === 'object') {
        return
      } else if (value !== '') {
        const stringValue = typeof value === 'string' ? value.trim() : String(value)
        if (stringValue) params.set(key, stringValue)
      }
    })
    const advancedParams = serializeTree(advancedFilterState)
    for (const [key, val] of Object.entries(advancedParams)) {
      params.set(key, val)
    }
    return params.toString()
  }, [advancedFilterState, filterValues, page, pageSize, search, sorting, tagIdToLabel, tagLabelToId])

  const currentParams = React.useMemo(() => Object.fromEntries(new URLSearchParams(queryParams)), [queryParams])
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
      await apiCallOrThrow(
        `/api/customers/people?id=${encodeURIComponent(person.id)}`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        },
        { errorMessage: t('customers.people.list.deleteError') },
      )
      setRows((prev) => prev.filter((row) => row.id !== person.id))
      setTotal((prev) => Math.max(prev - 1, 0))
      handleRefresh()
      flash(t('customers.people.list.deleteSuccess'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.list.deleteError')
      flash(message, 'error')
    }
  }, [confirm, handleRefresh, t])

  const handleBulkDelete = React.useCallback(async (selectedRows: PersonRow[]) => {
    const confirmed = await confirm({
      title: t('customers.people.list.bulkDelete.title', 'Delete {count} people?', { count: selectedRows.length }),
      description: t('customers.people.list.bulkDelete.description', 'This action cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return false
    let deletedCount = 0
    const failedIds: string[] = []
    for (const row of selectedRows) {
      try {
        await apiCallOrThrow(`/api/customers/people?id=${encodeURIComponent(row.id)}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        })
        deletedCount++
      } catch (err) {
        failedIds.push(row.id)
        console.warn('[customers.people.list] bulk delete failed', row.id, err)
      }
    }
    if (deletedCount > 0) {
      setRows((prev) => {
        const succeeded = new Set(selectedRows.map((r) => r.id).filter((id) => !failedIds.includes(id)))
        return prev.filter((r) => !succeeded.has(r.id))
      })
      setTotal((prev) => Math.max(0, prev - deletedCount))
      if (failedIds.length === 0) {
        flash(t('customers.people.list.bulkDelete.success', '{count} people deleted', { count: deletedCount }), 'success')
      } else {
        flash(
          t('customers.people.list.bulkDelete.partial', '{deleted} of {total} people deleted; {failed} failed', {
            deleted: deletedCount,
            total: selectedRows.length,
            failed: failedIds.length,
          }),
          'warning',
        )
      }
      setReloadToken((prev) => prev + 1)
    } else if (failedIds.length > 0) {
      flash(t('customers.people.list.bulkDelete.failed', 'Failed to delete {count} people', { count: failedIds.length }), 'error')
    }
    return deletedCount > 0
  }, [confirm, t])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const next: FilterValues = {}
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined) {
        next[key] = value
      }
    })
    const rawTags = Array.isArray(values.tagIds) ? (values.tagIds as string[]) : []
    const sanitizedTags = rawTags
      .map((tag) => {
        const normalized = typeof tag === 'string' ? tag.trim() : ''
        if (!normalized) return ''
        return tagIdToLabel[normalized] ?? normalized
      })
      .filter((tag) => tag.length > 0)
    if (sanitizedTags.length) next.tagIds = sanitizedTags
    else delete next.tagIds
    setFilterValues(next)
    setPage(1)
  }, [setFilterValues, setPage, tagIdToLabel])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [setFilterValues, setPage])

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
        meta: { alwaysVisible: true, columnChooserGroup: 'Basic Info', filterKey: 'display_name', maxWidth: '240px' },
        cell: ({ row }) => (
          <Link href={`/backend/customers/people-v2/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'email',
        header: t('customers.people.list.columns.email'),
        meta: { columnChooserGroup: 'Contact', filterKey: 'primary_email', maxWidth: '220px' },
        cell: ({ row }) => row.original.email || <span className="text-muted-foreground text-sm">{t('customers.people.list.noValue')}</span>,
      },
      {
        accessorKey: 'status',
        header: t('customers.people.list.columns.status'),
        meta: { filterType: 'select' as const, filterOptions: dictionaryOptions.statuses, columnChooserGroup: 'Basic Info' },
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
        },
        cell: ({ row }) => renderDictionaryCell('lifecycle-stages', row.original.lifecycleStage),
      },
      {
        accessorKey: 'nextInteractionAt',
        header: t('customers.people.list.columns.nextInteraction'),
        meta: {
          columnChooserGroup: 'Dates',
          filterKey: 'next_interaction_at',
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
        meta: { filterType: 'select' as const, filterOptions: dictionaryOptions.sources, columnChooserGroup: 'Basic Info' },
        cell: ({ row }) => renderDictionaryCell('sources', row.original.source),
      },
      {
        accessorKey: 'firstName',
        header: t('customers.people.form.firstName', 'First name'),
        meta: { columnChooserGroup: 'Profile', hidden: true, filterKey: 'person_profile.first_name' },
        cell: ({ row }) => row.original.firstName || noValue,
      },
      {
        accessorKey: 'lastName',
        header: t('customers.people.form.lastName', 'Last name'),
        meta: { columnChooserGroup: 'Profile', hidden: true, filterKey: 'person_profile.last_name' },
        cell: ({ row }) => row.original.lastName || noValue,
      },
      {
        accessorKey: 'preferredName',
        header: t('customers.people.form.preferredName', 'Preferred name'),
        meta: { columnChooserGroup: 'Profile', hidden: true, filterKey: 'person_profile.preferred_name' },
        cell: ({ row }) => row.original.preferredName || noValue,
      },
      {
        accessorKey: 'jobTitle',
        header: t('customers.people.form.jobTitle', 'Job title'),
        meta: { columnChooserGroup: 'Profile', hidden: true, filterKey: 'person_profile.job_title' },
        cell: ({ row }) => row.original.jobTitle || noValue,
      },
      {
        accessorKey: 'department',
        header: t('customers.people.detail.fields.department', 'Department'),
        meta: { columnChooserGroup: 'Profile', hidden: true, filterKey: 'person_profile.department' },
        cell: ({ row }) => row.original.department || noValue,
      },
      {
        accessorKey: 'seniority',
        header: t('customers.people.detail.fields.seniority', 'Seniority'),
        meta: { columnChooserGroup: 'Profile', hidden: true, filterKey: 'person_profile.seniority' },
        cell: ({ row }) => row.original.seniority || noValue,
      },
      {
        accessorKey: 'timezone',
        header: t('customers.people.detail.fields.timezone', 'Timezone'),
        meta: { columnChooserGroup: 'Profile', hidden: true, filterKey: 'person_profile.timezone' },
        cell: ({ row }) => row.original.timezone || noValue,
      },
      {
        accessorKey: 'linkedInUrl',
        header: t('customers.people.detail.fields.linkedIn', 'LinkedIn'),
        meta: { columnChooserGroup: 'Socials', hidden: true, filterKey: 'person_profile.linked_in_url' },
        cell: ({ row }) => row.original.linkedInUrl || noValue,
      },
      {
        accessorKey: 'twitterUrl',
        header: t('customers.people.detail.fields.twitter', 'Twitter'),
        meta: { columnChooserGroup: 'Socials', hidden: true, filterKey: 'person_profile.twitter_url' },
        cell: ({ row }) => row.original.twitterUrl || noValue,
      },
      {
        accessorKey: 'description',
        header: t('customers.people.form.description', 'Description'),
        meta: { columnChooserGroup: 'Notes', hidden: true, filterKey: 'description' },
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
  }, [customFieldDefs, dictionaryMaps, dictionaryOptions, t])

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
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
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
              value: advancedFilterState,
              onChange: setAdvancedFilterState,
              onApply: () => { setPage(1) },
              onClear: () => { setAdvancedFilterState(createEmptyTree()); setPage(1) },
            }}
          virtualized
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage, cacheStatus, pageSizeOptions: [10, 25, 50, 100], onPageSizeChange: handlePageSizeChange }}
          isLoading={isLoading}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
