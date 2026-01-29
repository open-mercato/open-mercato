"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { FilterDef, FilterOption, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import type { TagOption } from '@open-mercato/ui/backend/detail'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Pencil } from 'lucide-react'

const PAGE_SIZE = 20

type ResourceRow = {
  id: string
  name: string
  resourceTypeId: string | null
  capacity: number | null
  tags?: TagOption[] | null
  isActive: boolean
  appearanceIcon?: string | null
  appearanceColor?: string | null
}

type ResourceTypeRow = {
  id: string
  name: string
  appearanceIcon: string | null
  appearanceColor: string | null
}

type ResourceGroupRow = {
  id: string
  name: string
  resourceTypeId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  rowKind: 'group'
  depth: number
}

type ResourceTableRow = (ResourceRow & { rowKind: 'resource'; depth: number }) | ResourceGroupRow

type ResourcesResponse = {
  items: Array<Record<string, unknown>>
  total: number
  page: number
  totalPages: number
}

type ResourceTypesResponse = {
  items: Array<Record<string, unknown>>
}

export default function ResourcesResourcesPage() {
  const [rows, setRows] = React.useState<ResourceRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [resourceTypes, setResourceTypes] = React.useState<Map<string, ResourceTypeRow>>(new Map())
  const [canManage, setCanManage] = React.useState(false)
  const [tagOptions, setTagOptions] = React.useState<FilterOption[]>([])
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const resourceTypeFilter = searchParams.get('resourceTypeId')
  const selectedResourceTypeId = typeof filterValues.resourceTypeId === 'string'
    ? filterValues.resourceTypeId
    : resourceTypeFilter

  React.useEffect(() => {
    setPage(1)
  }, [resourceTypeFilter])

  React.useEffect(() => {
    if (!resourceTypeFilter) return
    setFilterValues((prev) => {
      if (prev.resourceTypeId === resourceTypeFilter) return prev
      if (typeof prev.resourceTypeId === 'string' && prev.resourceTypeId.length > 0) return prev
      return { ...prev, resourceTypeId: resourceTypeFilter }
    })
  }, [resourceTypeFilter])

  React.useEffect(() => {
    let cancelled = false
    async function loadPermissions() {
      try {
        const call = await apiCall<{ granted?: string[]; ok?: boolean }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['resources.manage_resources'] }),
        })
        if (!cancelled) {
          const granted = Array.isArray(call.result?.granted) ? call.result?.granted : []
          setCanManage(call.result?.ok === true || granted.includes('resources.manage_resources'))
        }
      } catch {
        if (!cancelled) setCanManage(false)
      }
    }
    loadPermissions()
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function loadResourceTypes() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100' })
        const call = await apiCall<ResourceTypesResponse>(`/api/resources/resource-types?${params.toString()}`)
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const map = new Map<string, ResourceTypeRow>()
        for (const item of items) {
          const raw = item as Record<string, unknown>
          const id = typeof raw.id === 'string' ? raw.id : ''
          const name = typeof raw.name === 'string' ? raw.name : id
          const appearanceIcon = typeof raw.appearanceIcon === 'string'
            ? raw.appearanceIcon
            : typeof raw.appearance_icon === 'string'
              ? raw.appearance_icon
              : null
          const appearanceColor = typeof raw.appearanceColor === 'string'
            ? raw.appearanceColor
            : typeof raw.appearance_color === 'string'
              ? raw.appearance_color
              : null
          map.set(id, {
            id,
            name,
            appearanceIcon,
            appearanceColor,
          })
        }
        if (!cancelled) setResourceTypes(map)
      } catch {
        if (!cancelled) setResourceTypes(new Map())
      }
    }
    loadResourceTypes()
    return () => { cancelled = true }
  }, [scopeVersion])

  const loadTagOptions = React.useCallback(
    async (query?: string): Promise<FilterOption[]> => {
      try {
        const params = new URLSearchParams({ pageSize: '100' })
        if (query && query.trim().length) params.set('search', query.trim())
        const call = await apiCall<{ items?: Array<{ id?: string; label?: string; slug?: string }> }>(`/api/resources/tags?${params.toString()}`)
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const options = items
          .map((entry) => {
            const value = typeof entry.id === 'string' ? entry.id : null
            if (!value) return null
            const label = typeof entry.label === 'string' && entry.label.trim().length
              ? entry.label.trim()
              : typeof entry.slug === 'string' && entry.slug.trim().length
                ? entry.slug.trim()
                : value
            return { value, label }
          })
          .filter((option): option is FilterOption => option !== null)
        if (options.length > 0) {
          setTagOptions((prev) => {
            const map = new Map(prev.map((opt) => [opt.value, opt]))
            options.forEach((opt) => map.set(opt.value, opt))
            return Array.from(map.values())
          })
        }
        return options
      } catch {
        return []
      }
    },
    [],
  )

  const resourceTypeOptions = React.useMemo<FilterOption[]>(() => {
    const entries = Array.from(resourceTypes.values())
    entries.sort((a, b) => a.name.localeCompare(b.name))
    return entries.map((entry) => ({ value: entry.id, label: entry.name }))
  }, [resourceTypes])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'resourceTypeId',
      label: t('resources.resources.list.filters.resourceType', 'Resource type'),
      type: 'select',
      options: resourceTypeOptions,
    },
    {
      id: 'tagIds',
      label: t('resources.resources.list.filters.tags', 'Tags'),
      type: 'tags',
      loadOptions: loadTagOptions,
      options: tagOptions,
    },
  ], [loadTagOptions, resourceTypeOptions, tagOptions, t])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)

    const params = new URLSearchParams(searchParams?.toString())
    const hasResourceType = typeof values.resourceTypeId === 'string' && values.resourceTypeId.length > 0
    if (!hasResourceType && params.has('resourceTypeId')) {
      params.delete('resourceTypeId')
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname)
    }
  }, [pathname, router, searchParams])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)

    const params = new URLSearchParams(searchParams?.toString())
    if (params.has('resourceTypeId')) {
      params.delete('resourceTypeId')
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname)
    }
  }, [pathname, router, searchParams])

  const groupedRows = React.useMemo(() => {
    const grouped: ResourceTableRow[] = []
    if (!rows.length) return grouped
    const byType = new Map<string, ResourceRow[]>()
    const unassigned: ResourceRow[] = []
    rows.forEach((row) => {
      if (!row.resourceTypeId) {
        unassigned.push(row)
        return
      }
      const list = byType.get(row.resourceTypeId) ?? []
      list.push(row)
      byType.set(row.resourceTypeId, list)
    })
    const typeEntries = Array.from(byType.entries())
      .map(([typeId, list]) => ({
        typeId,
        list,
        type: resourceTypes.get(typeId),
      }))
      .sort((a, b) => {
        const nameA = a.type?.name ?? ''
        const nameB = b.type?.name ?? ''
        return nameA.localeCompare(nameB)
      })
    for (const entry of typeEntries) {
      const label = entry.type?.name ?? t('resources.resources.list.group.unknown', 'Unknown type')
      grouped.push({
        id: `group:${entry.typeId}`,
        name: label,
        resourceTypeId: entry.typeId,
        appearanceIcon: entry.type?.appearanceIcon ?? null,
        appearanceColor: entry.type?.appearanceColor ?? null,
        rowKind: 'group',
        depth: 0,
      })
      entry.list.forEach((resource) => {
        grouped.push({ ...resource, rowKind: 'resource', depth: 1 })
      })
    }
    if (unassigned.length) {
      grouped.push({
        id: 'group:unassigned',
        name: t('resources.resources.list.group.unassigned', 'Unassigned'),
        resourceTypeId: null,
        appearanceIcon: null,
        appearanceColor: null,
        rowKind: 'group',
        depth: 0,
      })
      unassigned.forEach((resource) => {
        grouped.push({ ...resource, rowKind: 'resource', depth: 1 })
      })
    }
    return grouped
  }, [resourceTypes, rows, t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        })
        if (search) params.set('search', search)
        if (selectedResourceTypeId) params.set('resourceTypeId', selectedResourceTypeId)
        const tagIds = Array.isArray(filterValues.tagIds)
          ? filterValues.tagIds
              .map((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim()))
              .filter((value) => value.length > 0)
          : []
        if (tagIds.length > 0) params.set('tagIds', tagIds.join(','))
        const fallback: ResourcesResponse = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResourcesResponse>(`/api/resources/resources?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          flash(t('resources.resources.list.error.load', 'Failed to load resources.'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          const items = Array.isArray(payload.items) ? payload.items : []
          const mapped = items.map(mapApiResource)
          setRows(mapped)
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : t('resources.resources.list.error.load', 'Failed to load resources.')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [filterValues, page, search, scopeVersion, selectedResourceTypeId, t])

  const handleDelete = React.useCallback(async (row: ResourceTableRow) => {
    if (row.rowKind !== 'resource') return
    const confirmLabel = t('resources.resources.list.confirmDelete', 'Delete resource "{name}"?', { name: row.name })
    if (!window.confirm(confirmLabel)) return
    try {
      await deleteCrud('resources/resources', row.id, {
        errorMessage: t('resources.resources.list.error.delete', 'Failed to delete resource.'),
      })
      flash(t('resources.resources.list.flash.deleted', 'Resource deleted.'), 'success')
      setPage(1)
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('resources.resources.list.error.delete', 'Failed to delete resource.')
      flash(message, 'error')
    }
  }, [router, t])

  const columns = React.useMemo<ColumnDef<ResourceTableRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('resources.resources.list.columns.name', 'Resource'),
      meta: { priority: 1 },
      cell: ({ row }) => {
        const depth = row.original.depth ?? 0
        const indent = depth > 0 ? 18 : 0
        const isGroup = row.original.rowKind === 'group'
        const showEdit = isGroup && canManage && row.original.resourceTypeId
        return (
          <div className={isGroup ? 'flex items-center justify-between gap-3' : 'flex items-center gap-2'}>
            <span style={{ marginLeft: indent }} className={isGroup ? 'text-sm font-semibold text-foreground' : 'text-sm font-medium text-foreground'}>
              {row.original.name}
            </span>
            {showEdit ? (
              <Button
                asChild
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title={t('resources.resourceTypes.actions.edit', 'Edit')}
                aria-label={t('resources.resourceTypes.actions.edit', 'Edit')}
              >
                <Link href={`/backend/resources/resource-types/${encodeURIComponent(row.original.resourceTypeId ?? '')}/edit`}>
                  <Pencil className="h-4 w-4" />
                </Link>
              </Button>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'appearance',
      header: t('resources.resources.list.columns.appearance', 'Appearance'),
      meta: { priority: 2 },
      cell: ({ row }) => {
        const isGroup = row.original.rowKind === 'group'
        const typeId = row.original.resourceTypeId ?? ''
        const type = resourceTypes.get(typeId) ?? null
        const icon = isGroup
          ? row.original.appearanceIcon
          : row.original.appearanceIcon ?? type?.appearanceIcon
        const color = isGroup
          ? row.original.appearanceColor
          : row.original.appearanceColor ?? type?.appearanceColor
        if (!icon && !color) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <div className="flex items-center gap-2">
            {color ? renderDictionaryColor(color) : null}
            {icon ? renderDictionaryIcon(icon) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'resourceTypeId',
      header: t('resources.resources.list.columns.type', 'Type'),
      meta: { priority: 3 },
      cell: ({ row }) => {
        if (row.original.rowKind === 'group') return null
        return resourceTypes.get(row.original.resourceTypeId ?? '')?.name || t('resources.resources.list.columns.type.empty', 'Unassigned')
      },
    },
    {
      accessorKey: 'capacity',
      header: t('resources.resources.list.columns.capacity', 'Capacity'),
      meta: { priority: 4 },
      cell: ({ row }) => row.original.rowKind === 'group'
        ? null
        : row.original.capacity ?? t('resources.resources.list.columns.capacity.empty', '-'),
    },
    {
      accessorKey: 'tags',
      header: t('resources.resources.list.columns.tags', 'Tags'),
      meta: { priority: 5 },
      cell: ({ row }) => {
        if (row.original.rowKind === 'group') {
          return null
        }
        const tags = row.original.tags ?? []
        if (!tags.length) return <span className="text-xs text-muted-foreground">{t('resources.resources.list.columns.tags.empty', '-')}</span>
        return (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span key={tag.id} className="rounded-full border px-2 py-0.5 text-xs font-medium">
                {tag.label}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      accessorKey: 'isActive',
      header: t('resources.resources.list.columns.active', 'Active'),
      meta: { priority: 6 },
      cell: ({ row }) => row.original.rowKind === 'group' ? null : <BooleanIcon value={row.original.isActive} />,
    },
  ], [canManage, resourceTypes, t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('resources.resources.page.title', 'Resources')}
          actions={canManage ? (
            <Button asChild>
              <Link href="/backend/resources/resources/create">{t('resources.resources.list.actions.create', 'New resource')}</Link>
            </Button>
          ) : null}
          columns={columns}
          data={groupedRows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          perspective={{ tableId: 'resources.resources.list' }}
          rowActions={(row) => {
            if (!canManage || row.rowKind !== 'resource') return null
            return (
              <RowActions items={[
                { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/resources/resources/${encodeURIComponent(row.id)}` },
                { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]} />
            )
          }}
          onRowClick={canManage ? (row) => {
            if (row.rowKind !== 'resource') return
            router.push(`/backend/resources/resources/${encodeURIComponent(row.id)}`)
          } : undefined}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}

function mapApiResource(item: Record<string, unknown>): ResourceRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : id
  const resourceTypeId = typeof item.resourceTypeId === 'string'
    ? item.resourceTypeId
    : typeof item.resource_type_id === 'string'
      ? item.resource_type_id
      : null
  const capacity = typeof item.capacity === 'number'
    ? item.capacity
    : typeof item.capacity === 'string'
      ? Number(item.capacity)
      : null
  const isActive = typeof item.isActive === 'boolean'
    ? item.isActive
    : typeof item.is_active === 'boolean'
      ? item.is_active
      : false
  const appearanceIcon = typeof item.appearanceIcon === 'string'
    ? item.appearanceIcon
    : typeof item.appearance_icon === 'string'
      ? item.appearance_icon
      : null
  const appearanceColor = typeof item.appearanceColor === 'string'
    ? item.appearanceColor
    : typeof item.appearance_color === 'string'
      ? item.appearance_color
      : null
  const tags = Array.isArray(item.tags) ? item.tags as TagOption[] : []
  return {
    id,
    name,
    resourceTypeId,
    capacity: Number.isFinite(capacity as number) ? capacity as number : null,
    tags,
    isActive,
    appearanceIcon,
    appearanceColor,
  }
}
