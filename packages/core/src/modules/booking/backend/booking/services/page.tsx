"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import type { PluggableList } from 'unified'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { FilterDef, FilterOption, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import type { TagOption } from '@open-mercato/ui/backend/detail'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const PAGE_SIZE = 20
const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'
const MARKDOWN_CLASSNAME =
  'text-sm text-foreground break-words [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs'

type MarkdownPreviewProps = { children: string; className?: string; remarkPlugins?: PluggableList }

const MarkdownPreview: React.ComponentType<MarkdownPreviewProps> = isTestEnv
  ? ({ children, className }) => <div className={className}>{children}</div>
  : (dynamic(() => import('react-markdown').then((mod) => mod.default as React.ComponentType<MarkdownPreviewProps>), {
      ssr: false,
      loading: () => null,
    }) as unknown as React.ComponentType<MarkdownPreviewProps>)

let markdownPluginsPromise: Promise<PluggableList> | null = null

async function loadMarkdownPlugins(): Promise<PluggableList> {
  if (isTestEnv) return []
  if (!markdownPluginsPromise) {
    markdownPluginsPromise = import('remark-gfm')
      .then((mod) => [mod.default ?? mod] as PluggableList)
      .catch(() => [])
  }
  return markdownPluginsPromise
}

type ServiceRow = {
  id: string
  name: string
  description: string | null
  durationMinutes: number | null
  maxAttendees: number | null
  tags?: TagOption[] | null
  isActive: boolean
}

type ServicesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

export default function BookingServicesPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<ServiceRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [tagOptions, setTagOptions] = React.useState<FilterOption[]>([])
  const [markdownPlugins, setMarkdownPlugins] = React.useState<PluggableList>([])

  React.useEffect(() => {
    void loadMarkdownPlugins().then((plugins) => setMarkdownPlugins(plugins))
  }, [])

  const labels = React.useMemo(() => ({
    title: t('booking.services.page.title', 'Services'),
    description: t('booking.services.page.description', 'Define booking services and their constraints.'),
    table: {
      name: t('booking.services.table.name', 'Name'),
      description: t('booking.services.table.description', 'Description'),
      duration: t('booking.services.table.duration', 'Duration'),
      durationUnit: t('booking.services.table.durationUnit', 'min'),
      maxAttendees: t('booking.services.table.maxAttendees', 'Max attendees'),
      tags: t('booking.services.table.tags', 'Tags'),
      active: t('booking.services.table.active', 'Active'),
      empty: t('booking.services.table.empty', 'No services yet.'),
      search: t('booking.services.table.search', 'Search services...'),
    },
    filters: {
      tags: t('booking.services.filters.tags', 'Tags'),
      duration: t('booking.services.filters.duration', 'Duration (min)'),
      durationPlaceholder: t('booking.services.filters.duration.placeholder', 'Minutes'),
      maxAttendees: t('booking.services.filters.maxAttendees', 'Max attendees'),
      maxAttendeesPlaceholder: t('booking.services.filters.maxAttendees.placeholder', 'Count'),
    },
    errors: {
      load: t('booking.services.errors.load', 'Failed to load services.'),
    },
  }), [t])

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
      label: labels.filters.tags,
      type: 'tags',
      loadOptions: loadTagOptions,
      options: tagOptions,
    },
    {
      id: 'duration',
      label: labels.filters.duration,
      type: 'text',
      placeholder: labels.filters.durationPlaceholder,
    },
    {
      id: 'maxAttendees',
      label: labels.filters.maxAttendees,
      type: 'text',
      placeholder: labels.filters.maxAttendeesPlaceholder,
    },
  ], [labels.filters, loadTagOptions, tagOptions])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        })
        if (search.trim()) params.set('search', search.trim())
        const tagIds = Array.isArray(filterValues.tagIds)
          ? filterValues.tagIds
              .map((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim()))
              .filter((value) => value.length > 0)
          : []
        if (tagIds.length > 0) params.set('tagIds', tagIds.join(','))
        const duration = typeof filterValues.duration === 'string' ? filterValues.duration.trim() : ''
        if (duration) params.set('duration', duration)
        const maxAttendees = typeof filterValues.maxAttendees === 'string' ? filterValues.maxAttendees.trim() : ''
        if (maxAttendees) params.set('maxAttendees', maxAttendees)
        const fallback: ServicesResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<ServicesResponse>(`/api/booking/services?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          flash(labels.errors.load, 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          const items = Array.isArray(payload.items) ? payload.items : []
          setRows(items.map(mapApiService))
          setTotal(typeof payload.total === 'number' ? payload.total : items.length)
          setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : labels.errors.load
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [filterValues, labels.errors.load, page, search, scopeVersion])

  const columns = React.useMemo<ColumnDef<ServiceRow>[]>(() => [
    {
      accessorKey: 'name',
      header: labels.table.name,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          {row.original.description ? (
            <MarkdownPreview
              remarkPlugins={markdownPlugins}
              className={`${MARKDOWN_CLASSNAME} text-xs text-muted-foreground line-clamp-2`}
            >
              {row.original.description}
            </MarkdownPreview>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: labels.table.description,
      meta: { priority: 5 },
      cell: ({ row }) => row.original.description
        ? (
          <MarkdownPreview remarkPlugins={markdownPlugins} className={MARKDOWN_CLASSNAME}>
            {row.original.description}
          </MarkdownPreview>
        )
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'durationMinutes',
      header: labels.table.duration,
      meta: { priority: 2 },
      cell: ({ row }) => row.original.durationMinutes != null
        ? <span className="text-sm">{row.original.durationMinutes} {labels.table.durationUnit}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'maxAttendees',
      header: labels.table.maxAttendees,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.maxAttendees != null
        ? <span className="text-sm">{row.original.maxAttendees}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      accessorKey: 'tags',
      header: labels.table.tags,
      meta: { priority: 4 },
      cell: ({ row }) => {
        const tags = row.original.tags ?? []
        if (!tags.length) return <span className="text-xs text-muted-foreground">-</span>
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
      header: labels.table.active,
      meta: { priority: 6 },
      cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
    },
  ], [labels.table, markdownPlugins])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={labels.title}
          columns={columns}
          data={rows}
          searchValue={search}
          searchPlaceholder={labels.table.search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          perspective={{ tableId: 'booking.services.list' }}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}

function mapApiService(item: Record<string, unknown>): ServiceRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : id
  const description = typeof item.description === 'string' ? item.description : null
  const durationMinutes = typeof item.durationMinutes === 'number'
    ? item.durationMinutes
    : typeof item.duration_minutes === 'number'
      ? item.duration_minutes
      : typeof item.duration_minutes === 'string'
        ? Number(item.duration_minutes)
        : null
  const maxAttendees = typeof item.maxAttendees === 'number'
    ? item.maxAttendees
    : typeof item.max_attendees === 'number'
      ? item.max_attendees
      : typeof item.max_attendees === 'string'
        ? Number(item.max_attendees)
        : null
  const isActive = typeof item.isActive === 'boolean'
    ? item.isActive
    : typeof item.is_active === 'boolean'
      ? item.is_active
      : false
  const tags = Array.isArray(item.tags) ? item.tags as TagOption[] : []
  return {
    id,
    name,
    description,
    durationMinutes: Number.isFinite(durationMinutes as number) ? durationMinutes as number : null,
    maxAttendees: Number.isFinite(maxAttendees as number) ? maxAttendees as number : null,
    tags,
    isActive,
  }
}
