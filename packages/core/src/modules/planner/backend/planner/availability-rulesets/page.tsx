"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import type { PluggableList } from 'unified'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const PAGE_SIZE = 50
const MARKDOWN_PLUGINS: PluggableList = [remarkGfm]
const MARKDOWN_SUBTEXT_CLASSNAME =
  'line-clamp-2 text-xs text-muted-foreground [&>p]:m-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5'

type RuleSetRow = {
  id: string
  name: string
  description: string | null
  timezone: string
  updatedAt: string | null
}

type RuleSetResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

export default function PlannerAvailabilityRuleSetsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<RuleSetRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const labels = React.useMemo(() => ({
    title: t('planner.availabilityRuleSets.page.title', 'Availability schedules'),
    description: t('planner.availabilityRuleSets.page.description', 'Manage shared availability rulesets.'),
    table: {
      name: t('planner.availabilityRuleSets.table.name', 'Name'),
      timezone: t('planner.availabilityRuleSets.table.timezone', 'Timezone'),
      updatedAt: t('planner.availabilityRuleSets.table.updatedAt', 'Updated'),
      empty: t('planner.availabilityRuleSets.table.empty', 'No schedules yet.'),
      search: t('planner.availabilityRuleSets.table.search', 'Search schedules...'),
    },
    actions: {
      add: t('planner.availabilityRuleSets.actions.add', 'New schedule'),
      edit: t('planner.availabilityRuleSets.actions.edit', 'Edit'),
      delete: t('planner.availabilityRuleSets.actions.delete', 'Delete'),
      deleteConfirm: t('planner.availabilityRuleSets.actions.deleteConfirm', 'Delete schedule "{{name}}"?'),
      refresh: t('planner.availabilityRuleSets.actions.refresh', 'Refresh'),
    },
    messages: {
      deleted: t('planner.availabilityRuleSets.messages.deleted', 'Schedule deleted.'),
    },
    errors: {
      load: t('planner.availabilityRuleSets.errors.load', 'Failed to load schedules.'),
      delete: t('planner.availabilityRuleSets.errors.delete', 'Failed to delete schedule.'),
    },
  }), [t])

  const loadRuleSets = React.useCallback(async () => {
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
      if (search.trim()) params.set('search', search.trim())
      const payload = await readApiResultOrThrow<RuleSetResponse>(
        `/api/planner/availability-rule-sets?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapRuleSet))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
    } catch (error) {
      console.error('planner.availability-rule-sets.list', error)
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [labels.errors.load, page, search, sorting])

  React.useEffect(() => {
    void loadRuleSets()
  }, [loadRuleSets, scopeVersion, reloadToken])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(async (entry: RuleSetRow) => {
    const message = labels.actions.deleteConfirm.replace('{{name}}', entry.name)
    if (typeof window !== 'undefined' && !window.confirm(message)) return
    try {
      await deleteCrud('planner/availability-rule-sets', entry.id, { errorMessage: labels.errors.delete })
      flash(labels.messages.deleted, 'success')
      handleRefresh()
    } catch (error) {
      console.error('planner.availability-rule-sets.delete', error)
      const normalized = normalizeCrudServerError(error)
      flash(normalized.message ?? labels.errors.delete, 'error')
    }
  }, [handleRefresh, labels.actions.deleteConfirm, labels.errors.delete, labels.messages.deleted])

  const columns = React.useMemo<ColumnDef<RuleSetRow>[]>(() => [
    {
      accessorKey: 'name',
      header: labels.table.name,
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
      accessorKey: 'timezone',
      header: labels.table.timezone,
      meta: { priority: 2 },
      cell: ({ row }) => <span className="text-sm">{row.original.timezone}</span>,
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.updatedAt
        ? <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>
        : <span className="text-xs text-muted-foreground">-</span>,
    },
  ], [labels.table.name, labels.table.timezone, labels.table.updatedAt])

  return (
    <Page>
      <PageBody>
        <DataTable<RuleSetRow>
          title={labels.title}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={labels.table.search}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{labels.table.empty}</p>}
          actions={(
            <Button asChild size="sm">
              <Link href="/backend/planner/availability-rulesets/create">
                {labels.actions.add}
              </Link>
            </Button>
          )}
          refreshButton={{
            label: labels.actions.refresh,
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: labels.actions.edit, href: `/backend/planner/availability-rulesets/${row.id}` },
                { id: 'delete', label: labels.actions.delete, destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/planner/availability-rulesets/${row.id}`)}
        />
      </PageBody>
    </Page>
  )
}

function mapRuleSet(item: Record<string, unknown>): RuleSetRow {
  const id = typeof item.id === 'string' ? item.id : ''
  const name = typeof item.name === 'string' ? item.name : id
  const description = typeof item.description === 'string' ? item.description : null
  const timezone = typeof item.timezone === 'string' ? item.timezone : 'UTC'
  const updatedAt =
    typeof item.updatedAt === 'string'
      ? item.updatedAt
      : typeof item.updated_at === 'string'
        ? item.updated_at
        : null
  return {
    id,
    name,
    description,
    timezone,
    updatedAt,
  }
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}
