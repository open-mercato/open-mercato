"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import type { PluggableList } from 'unified'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Package } from 'lucide-react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const PAGE_SIZE = 50
const MARKDOWN_PLUGINS: PluggableList = [remarkGfm]
const MARKDOWN_DESCRIPTION_CLASSNAME =
  'text-sm text-foreground [&>p]:m-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5'
const MARKDOWN_SUBTEXT_CLASSNAME =
  'text-xs text-muted-foreground [&>p]:m-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5'

type ResourceTypeRow = {
  id: string
  name: string
  description: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  updatedAt: string | null
  resourceCount: number
}

type ResourceTypesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

export default function ResourcesResourceTypesPage() {
  const translate = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<ResourceTypeRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const translations = React.useMemo(() => ({
    title: translate('resources.resourceTypes.page.title', 'Resource types'),
    description: translate('resources.resourceTypes.page.description', 'Organize shared resources by category.'),
    table: {
      name: translate('resources.resourceTypes.table.name', 'Name'),
      description: translate('resources.resourceTypes.table.description', 'Description'),
      appearance: translate('resources.resourceTypes.table.appearance', 'Appearance'),
      resources: translate('resources.resourceTypes.table.resources', 'Resources'),
      updatedAt: translate('resources.resourceTypes.table.updatedAt', 'Updated'),
      empty: translate('resources.resourceTypes.table.empty', 'No resource types yet.'),
      search: translate('resources.resourceTypes.table.search', 'Search resource types…'),
    },
    actions: {
      add: translate('resources.resourceTypes.actions.add', 'Add resource type'),
      edit: translate('resources.resourceTypes.actions.edit', 'Edit'),
      delete: translate('resources.resourceTypes.actions.delete', 'Delete'),
      deleteConfirm: translate('resources.resourceTypes.actions.deleteConfirm', 'Delete resource type "{{name}}"?'),
      showResources: translate('resources.resourceTypes.actions.showResources', 'Show resources ({{count}})'),
      refresh: translate('resources.resourceTypes.actions.refresh', 'Refresh'),
    },
    form: {
      createTitle: translate('resources.resourceTypes.form.createTitle', 'Add resource type'),
      editTitle: translate('resources.resourceTypes.form.editTitle', 'Edit resource type'),
      name: translate('resources.resourceTypes.form.name', 'Name'),
      description: translate('resources.resourceTypes.form.description', 'Description'),
      save: translate('resources.resourceTypes.form.save', 'Save'),
      cancel: translate('resources.resourceTypes.form.cancel', 'Cancel'),
    },
    messages: {
      saved: translate('resources.resourceTypes.messages.saved', 'Resource type saved.'),
      deleted: translate('resources.resourceTypes.messages.deleted', 'Resource type deleted.'),
    },
    errors: {
      load: translate('resources.resourceTypes.errors.load', 'Failed to load resource types.'),
      save: translate('resources.resourceTypes.errors.save', 'Failed to save resource type.'),
      delete: translate('resources.resourceTypes.errors.delete', 'Failed to delete resource type.'),
      deleteAssigned: translate('resources.resourceTypes.errors.deleteAssigned', 'Resource type has assigned resources.'),
    },
  }), [translate])

  const columns = React.useMemo<ColumnDef<ResourceTypeRow>[]>(() => [
    {
      accessorKey: 'name',
      header: translations.table.name,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          {row.original.description ? (
            <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS} className={MARKDOWN_SUBTEXT_CLASSNAME}>
              {row.original.description}
            </ReactMarkdown>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'appearance',
      header: translations.table.appearance,
      meta: { priority: 2 },
      cell: ({ row }) => {
        const icon = row.original.appearanceIcon
        const color = row.original.appearanceColor
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
      accessorKey: 'resourceCount',
      header: translations.table.resources,
      meta: { priority: 3 },
      cell: ({ row }) => (
        <Link
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          href={`/backend/resources/resources?resourceTypeId=${encodeURIComponent(row.original.id)}`}
          onClick={(event) => event.stopPropagation()}
        >
          <Package className="h-4 w-4" aria-hidden />
          {translations.actions.showResources.replace('{{count}}', String(row.original.resourceCount))}
        </Link>
      ),
    },
    {
      accessorKey: 'description',
      header: translations.table.description,
      meta: { priority: 5 },
      cell: ({ row }) => row.original.description ? (
        <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS} className={MARKDOWN_DESCRIPTION_CLASSNAME}>
          {row.original.description}
        </ReactMarkdown>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: translations.table.updatedAt,
      meta: { priority: 4 },
      cell: ({ row }) => row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
  ], [
    translations.actions.showResources,
    translations.table.appearance,
    translations.table.description,
    translations.table.name,
    translations.table.resources,
    translations.table.updatedAt,
  ])

  const loadResourceTypes = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      const sort = sorting[0]
      if (sort?.id) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      if (search.trim()) {
        params.set('search', search.trim())
      }
      const payload = await readApiResultOrThrow<ResourceTypesResponse>(
        `/api/resources/resource-types?${params.toString()}`,
        undefined,
        { errorMessage: translations.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiResourceType))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (error) {
      console.error('resources.resource-types.list', error)
      flash(translations.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [page, search, sorting, translations.errors.load])

  React.useEffect(() => {
    void loadResourceTypes()
  }, [loadResourceTypes, scopeVersion, reloadToken])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (entry: ResourceTypeRow) => {
    if (entry.resourceCount > 0) {
      flash(translations.errors.deleteAssigned, 'error')
      return
    }
    const message = translations.actions.deleteConfirm.replace('{{name}}', entry.name)
    const confirmed = await confirm({
      title: message,
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await deleteCrud('resources/resource-types', entry.id, { errorMessage: translations.errors.delete })
      flash(translations.messages.deleted, 'success')
      handleRefresh()
    } catch (error) {
      console.error('resources.resource-types.delete', error)
      flash(translations.errors.delete, 'error')
    }
  }, [confirm, handleRefresh, translations.actions.deleteConfirm, translations.errors.delete, translations.errors.deleteAssigned, translations.messages.deleted])

  return (
    <Page>
      <PageBody>
        <DataTable<ResourceTypeRow>
          title={translations.title}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={translations.table.search}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{translations.table.empty}</p>}
          actions={(
            <Button asChild size="sm">
              <Link href="/backend/resources/resource-types/create">
                {translations.actions.add}
              </Link>
            </Button>
          )}
          refreshButton={{
            label: translations.actions.refresh,
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: translations.actions.edit, href: `/backend/resources/resource-types/${row.id}/edit` },
                ...(row.resourceCount > 0
                  ? []
                  : [{ id: 'delete', label: translations.actions.delete, destructive: true, onSelect: () => handleDelete(row) }]),
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/resources/resource-types/${row.id}/edit`)}
          perspective={{ tableId: 'resources.resource-types.list' }}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}

function mapApiResourceType(item: Record<string, unknown>): ResourceTypeRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' && item.name.length ? item.name : id
  const description = typeof item.description === 'string' && item.description.length
    ? item.description
    : typeof item.description === 'string'
      ? item.description
      : null
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
  const updatedAt = typeof item.updatedAt === 'string'
    ? item.updatedAt
    : typeof item.updated_at === 'string'
      ? item.updated_at
      : null
  const resourceCount = typeof item.resourceCount === 'number'
    ? item.resourceCount
    : typeof item.resource_count === 'number'
      ? item.resource_count
      : 0
  return { id, name, description, appearanceIcon, appearanceColor, updatedAt, resourceCount }
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
