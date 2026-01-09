"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

const PAGE_SIZE = 20

type ResourceRow = {
  id: string
  name: string
  resourceTypeId: string | null
  capacity: number | null
  tags?: TagOption[] | null
  isActive: boolean
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
  items: ResourceRow[]
  total: number
  page: number
  totalPages: number
}

type ResourceTypesResponse = {
  items: ResourceTypeRow[]
}

export default function BookingResourcesPage() {
  const [rows, setRows] = React.useState<ResourceTableRow[]>([])
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

  React.useEffect(() => {
    let cancelled = false
    async function loadPermissions() {
      try {
        const call = await apiCall<{ granted?: string[]; ok?: boolean }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['booking.manage_resources'] }),
        })
        if (!cancelled) {
          const granted = Array.isArray(call.result?.granted) ? call.result?.granted : []
          setCanManage(call.result?.ok === true || granted.includes('booking.manage_resources'))
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
        const params = new URLSearchParams({ page: '1', pageSize: '200' })
        const call = await apiCall<ResourceTypesResponse>(`/api/booking/resource-types?${params.toString()}`)
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const map = new Map<string, ResourceTypeRow>()
        for (const item of items) {
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
          map.set(item.id, {
            id: item.id,
            name: item.name,
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
        const call = await apiCall<{ items?: Array<{ id?: string; label?: string; slug?: string }> }>(`/api/booking/tags?${params.toString()}`)
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

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'tagIds',
      label: t('booking.resources.list.filters.tags', 'Tags'),
      type: 'tags',
      loadOptions: loadTagOptions,
      options: tagOptions,
    },
  ], [loadTagOptions, tagOptions, t])

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
      const label = entry.type?.name ?? t('booking.resources.list.group.unknown', 'Unknown type')
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
        name: t('booking.resources.list.group.unassigned', 'Unassigned'),
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
        const tagIds = Array.isArray(filterValues.tagIds)
          ? filterValues.tagIds
              .map((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim()))
              .filter((value) => value.length > 0)
          : []
        if (tagIds.length > 0) params.set('tagIds', tagIds.join(','))
        const fallback: ResourcesResponse = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResourcesResponse>(`/api/booking/resources?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          flash(t('booking.resources.list.error.load', 'Failed to load resources.'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          const items = Array.isArray(payload.items) ? payload.items : []
          const mapped = items.map(mapApiResource)
          setRows(mapped.map((item) => ({ ...item, rowKind: 'resource', depth: 1 })))
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : t('booking.resources.list.error.load', 'Failed to load resources.')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [filterValues, page, search, scopeVersion, t])

  const handleDelete = React.useCallback(async (row: ResourceTableRow) => {
    if (row.rowKind !== 'resource') return
    const confirmLabel = t('booking.resources.list.confirmDelete', 'Delete resource "{name}"?', { name: row.name })
    if (!window.confirm(confirmLabel)) return
    try {
      await deleteCrud('booking/resources', row.id, {
        errorMessage: t('booking.resources.list.error.delete', 'Failed to delete resource.'),
      })
      flash(t('booking.resources.list.flash.deleted', 'Resource deleted.'), 'success')
      setPage(1)
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('booking.resources.list.error.delete', 'Failed to delete resource.')
      flash(message, 'error')
    }
  }, [router, t])

  const columns = React.useMemo<ColumnDef<ResourceTableRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('booking.resources.list.columns.name', 'Resource'),
      meta: { priority: 1 },
      cell: ({ row }) => {
        const depth = row.original.depth ?? 0
        const indent = depth > 0 ? 18 : 0
        const isGroup = row.original.rowKind === 'group'
        return (
          <div className="flex items-center gap-2">
            <span style={{ marginLeft: indent }} className={isGroup ? 'text-sm font-semibold text-foreground' : 'text-sm font-medium text-foreground'}>
              {row.original.name}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: 'appearance',
      header: t('booking.resources.list.columns.appearance', 'Appearance'),
      meta: { priority: 2 },
      cell: ({ row }) => {
        const isGroup = row.original.rowKind === 'group'
        const typeId = row.original.resourceTypeId ?? ''
        const type = resourceTypes.get(typeId) ?? null
        const icon = isGroup ? row.original.appearanceIcon : type?.appearanceIcon
        const color = isGroup ? row.original.appearanceColor : type?.appearanceColor
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
      header: t('booking.resources.list.columns.type', 'Type'),
      meta: { priority: 3 },
      cell: ({ row }) => {
        if (row.original.rowKind === 'group') return null
        return resourceTypes.get(row.original.resourceTypeId ?? '')?.name || t('booking.resources.list.columns.type.empty', 'Unassigned')
      },
    },
    {
      accessorKey: 'capacity',
      header: t('booking.resources.list.columns.capacity', 'Capacity'),
      meta: { priority: 4 },
      cell: ({ row }) => row.original.rowKind === 'group'
        ? null
        : row.original.capacity ?? t('booking.resources.list.columns.capacity.empty', '-'),
    },
    {
      accessorKey: 'tags',
      header: t('booking.resources.list.columns.tags', 'Tags'),
      meta: { priority: 5 },
      cell: ({ row }) => {
        if (row.original.rowKind === 'group') {
          return null
        }
        const tags = row.original.tags ?? []
        if (!tags.length) return <span className="text-xs text-muted-foreground">{t('booking.resources.list.columns.tags.empty', '-')}</span>
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
      header: t('booking.resources.list.columns.active', 'Active'),
      meta: { priority: 6 },
      cell: ({ row }) => row.original.rowKind === 'group' ? null : <BooleanIcon value={row.original.isActive} />,
    },
  ], [resourceTypes, t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('booking.resources.page.title', 'Resources')}
          actions={canManage ? (
            <Button asChild>
              <Link href="/backend/booking/resources/create">{t('booking.resources.list.actions.create', 'New resource')}</Link>
            </Button>
          ) : null}
          columns={columns}
          data={groupedRows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => { setFilterValues(values); setPage(1) }}
          onFiltersClear={() => { setFilterValues({}); setPage(1) }}
          perspective={{ tableId: 'booking.resources.list' }}
          rowActions={(row) => {
            if (!canManage || row.rowKind !== 'resource') return null
            return (
              <RowActions items={[
                { label: t('common.edit', 'Edit'), href: `/backend/booking/resources/${encodeURIComponent(row.id)}` },
                { label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]} />
            )
          }}
          onRowClick={canManage ? (row) => {
            if (row.rowKind !== 'resource') return
            router.push(`/backend/booking/resources/${encodeURIComponent(row.id)}`)
          } : undefined}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}

function mapApiResource(item: ResourceRow): ResourceRow {
  const resourceTypeId = item.resourceTypeId ?? (item as { resource_type_id?: string | null }).resource_type_id ?? null
  const isActive = item.isActive ?? (item as { is_active?: boolean }).is_active ?? false
  const tags = Array.isArray(item.tags) ? item.tags : (item as { tags?: TagOption[] | null }).tags ?? []
  const capacity = typeof item.capacity === 'number'
    ? item.capacity
    : (item as { capacity?: number | null }).capacity ?? null
  return {
    ...item,
    resourceTypeId,
    isActive,
    tags,
    capacity,
  }
}
