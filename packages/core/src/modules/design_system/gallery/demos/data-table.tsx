import * as React from 'react'
import type { SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { CheckCircle2, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable, type BulkAction } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

type ProjectStatus = 'active' | 'planned' | 'blocked' | 'completed'

type ProjectRow = {
  id: string
  name: string
  owner: string
  client: string
  region: 'north' | 'south' | 'east' | 'west'
  status: ProjectStatus
  phase: 'discovery' | 'delivery' | 'review'
  budget: number
  teamSize: number
  startDate: string
  dueDate: string
  summary: string
}

const PROJECT_ROWS: ProjectRow[] = [
  { id: 'p-01', name: 'Harbor relocation', owner: 'Mira Solberg', client: 'Tidewater Freight', region: 'north', status: 'active', phase: 'delivery', budget: 48000, teamSize: 6, startDate: '2026-01-12', dueDate: '2026-06-30', summary: 'Move two warehouses to the new quay' },
  { id: 'p-02', name: 'Billing cleanup', owner: 'Tomas Reyner', client: 'Pinecrest Supply', region: 'west', status: 'planned', phase: 'discovery', budget: 12500, teamSize: 2, startDate: '2026-03-02', dueDate: '2026-04-17', summary: 'Merge duplicate invoices and close old accounts' },
  { id: 'p-03', name: 'Route planning pilot', owner: 'Ines Valdor', client: 'Bluefield Courier', region: 'south', status: 'active', phase: 'review', budget: 27300, teamSize: 4, startDate: '2026-02-09', dueDate: '2026-05-22', summary: 'Test shorter delivery routes in three towns' },
  { id: 'p-04', name: 'Supplier onboarding', owner: 'Jonas Albrin', client: 'Rowan and Finch', region: 'east', status: 'blocked', phase: 'delivery', budget: 9800, teamSize: 3, startDate: '2026-01-26', dueDate: '2026-07-10', summary: 'Bring twelve new suppliers into the catalog' },
  { id: 'p-05', name: 'Store refit', owner: 'Mira Solberg', client: 'Lanterngate Stores', region: 'north', status: 'completed', phase: 'review', budget: 64200, teamSize: 8, startDate: '2025-10-06', dueDate: '2026-02-27', summary: 'New shelving and checkout layout' },
  { id: 'p-06', name: 'Returns desk', owner: 'Pavel Ostrin', client: 'Bluefield Courier', region: 'south', status: 'active', phase: 'delivery', budget: 15400, teamSize: 3, startDate: '2026-02-23', dueDate: '2026-06-05', summary: 'One counter for all returned parcels' },
  { id: 'p-07', name: 'Price list refresh', owner: 'Ines Valdor', client: 'Pinecrest Supply', region: 'west', status: 'planned', phase: 'discovery', budget: 7200, teamSize: 2, startDate: '2026-04-06', dueDate: '2026-05-15', summary: 'Yearly update of wholesale prices' },
  { id: 'p-08', name: 'Cold storage audit', owner: 'Tomas Reyner', client: 'Tidewater Freight', region: 'north', status: 'completed', phase: 'review', budget: 18900, teamSize: 4, startDate: '2025-11-17', dueDate: '2026-01-30', summary: 'Check temperature logs for every unit' },
  { id: 'p-09', name: 'Loyalty cards', owner: 'Jonas Albrin', client: 'Lanterngate Stores', region: 'east', status: 'active', phase: 'delivery', budget: 33100, teamSize: 5, startDate: '2026-01-05', dueDate: '2026-08-21', summary: 'Points for repeat customers' },
  { id: 'p-10', name: 'Fleet renewal', owner: 'Pavel Ostrin', client: 'Bluefield Courier', region: 'south', status: 'blocked', phase: 'discovery', budget: 91000, teamSize: 7, startDate: '2026-03-16', dueDate: '2026-11-27', summary: 'Replace fourteen delivery vans' },
  { id: 'p-11', name: 'Packing guide', owner: 'Mira Solberg', client: 'Rowan and Finch', region: 'east', status: 'planned', phase: 'discovery', budget: 4300, teamSize: 1, startDate: '2026-05-04', dueDate: '2026-06-12', summary: 'Short manual for fragile goods' },
  { id: 'p-12', name: 'Night shift roster', owner: 'Ines Valdor', client: 'Tidewater Freight', region: 'north', status: 'active', phase: 'delivery', budget: 11600, teamSize: 3, startDate: '2026-02-02', dueDate: '2026-04-24', summary: 'Fair rotation for the night crew' },
]

const SHORT_ROWS = PROJECT_ROWS.slice(0, 5)

const STATUS_VARIANTS: Record<ProjectStatus, StatusBadgeVariant> = {
  active: 'success',
  planned: 'info',
  blocked: 'error',
  completed: 'neutral',
}

const PROJECT_STATUSES: ProjectStatus[] = ['active', 'planned', 'blocked', 'completed']
const PROJECT_REGIONS: ProjectRow['region'][] = ['north', 'south', 'east', 'west']

const budgetFormat = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

function useProjectLabels() {
  const t = useT()
  return React.useMemo(() => {
    const status: Record<ProjectStatus, string> = {
      active: t('design_system.gallery.samples.content.active', 'Active'),
      planned: t('design_system.gallery.samples.dataTable.statusPlanned', 'Planned'),
      blocked: t('design_system.gallery.samples.dataTable.statusBlocked', 'Blocked'),
      completed: t('design_system.gallery.samples.content.completed', 'Completed'),
    }
    const region: Record<ProjectRow['region'], string> = {
      north: t('design_system.gallery.samples.dataTable.regionNorth', 'North'),
      south: t('design_system.gallery.samples.dataTable.regionSouth', 'South'),
      east: t('design_system.gallery.samples.dataTable.regionEast', 'East'),
      west: t('design_system.gallery.samples.dataTable.regionWest', 'West'),
    }
    const phase: Record<ProjectRow['phase'], string> = {
      discovery: t('design_system.gallery.samples.dataTable.phaseDiscovery', 'Discovery'),
      delivery: t('design_system.gallery.samples.dataTable.phaseDelivery', 'Delivery'),
      review: t('design_system.gallery.samples.dataTable.phaseReview', 'Review'),
    }
    return {
      status,
      region,
      phase,
      title: t('design_system.gallery.samples.dataTable.title', 'Projects'),
      create: t('design_system.gallery.samples.dataTable.create', 'New project'),
      name: t('design_system.gallery.samples.content.name', 'Name'),
      owner: t('design_system.gallery.samples.content.owner', 'Owner'),
      statusHeader: t('design_system.gallery.samples.content.status', 'Status'),
      client: t('design_system.gallery.samples.dataTable.client', 'Client'),
      regionHeader: t('design_system.gallery.samples.dataTable.region', 'Region'),
      phaseHeader: t('design_system.gallery.samples.dataTable.phase', 'Phase'),
      budget: t('design_system.gallery.samples.dataTable.budget', 'Budget'),
      teamSize: t('design_system.gallery.samples.dataTable.teamSize', 'Team'),
      startDate: t('design_system.gallery.samples.dataTable.startDate', 'Start'),
      dueDate: t('design_system.gallery.samples.dataTable.dueDate', 'Due'),
      summary: t('design_system.gallery.samples.dataTable.summary', 'Summary'),
      searchPlaceholder: t('design_system.gallery.samples.dataTable.searchPlaceholder', 'Search projects'),
      entityPlural: t('design_system.gallery.samples.dataTable.entityPlural', 'projects'),
      edit: t('design_system.gallery.samples.dataTable.edit', 'Edit'),
      duplicate: t('design_system.gallery.samples.content.duplicate', 'Duplicate'),
      remove: t('design_system.gallery.samples.content.delete', 'Delete'),
      markCompleted: t('design_system.gallery.samples.dataTable.markCompleted', 'Mark completed'),
      refresh: t('design_system.gallery.samples.dataTable.refresh', 'Reload'),
      loadError: t('design_system.gallery.samples.dataTable.loadError', 'Projects could not be loaded. Reload to try again.'),
      embeddedTitle: t('design_system.gallery.samples.dataTable.embeddedTitle', 'Projects for this client'),
      embeddedDescription: t('design_system.gallery.samples.dataTable.embeddedDescription', 'Work linked to Tidewater Freight.'),
    }
  }, [t])
}

type ProjectLabels = ReturnType<typeof useProjectLabels>

function baseColumns(labels: ProjectLabels): ColumnDef<ProjectRow, unknown>[] {
  return [
    { accessorKey: 'name', header: labels.name, cell: ({ row }) => <span className="whitespace-nowrap text-foreground">{row.original.name}</span> },
    { accessorKey: 'owner', header: labels.owner, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.owner}</span> },
    {
      accessorKey: 'status',
      header: labels.statusHeader,
      cell: ({ row }) => (
        <StatusBadge variant={STATUS_VARIANTS[row.original.status]} dot>
          {labels.status[row.original.status]}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'budget',
      header: labels.budget,
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{budgetFormat.format(row.original.budget)}</span>,
    },
    { accessorKey: 'dueDate', header: labels.dueDate, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.dueDate}</span> },
  ]
}

function wideColumns(labels: ProjectLabels): ColumnDef<ProjectRow, unknown>[] {
  const [name, owner, status, budget, dueDate] = baseColumns(labels)
  return [
    name,
    owner,
    status,
    { accessorKey: 'client', header: labels.client, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.client}</span> },
    { accessorKey: 'region', header: labels.regionHeader, cell: ({ row }) => labels.region[row.original.region] },
    { accessorKey: 'phase', header: labels.phaseHeader, cell: ({ row }) => labels.phase[row.original.phase] },
    budget,
    { accessorKey: 'teamSize', header: labels.teamSize, cell: ({ row }) => <span className="tabular-nums">{row.original.teamSize}</span> },
    { accessorKey: 'startDate', header: labels.startDate, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.startDate}</span> },
    dueDate,
    { accessorKey: 'summary', header: labels.summary, cell: ({ row }) => <span className="block min-w-96 text-muted-foreground">{row.original.summary}</span> },
  ]
}

function CreateProjectButton({ label }: { label: string }) {
  return (
    <Button type="button" size="sm" onClick={() => flash(label, 'info')}>
      <Plus className="size-4" aria-hidden />
      {label}
    </Button>
  )
}

function projectRowActions(labels: ProjectLabels, row: ProjectRow) {
  return (
    <RowActions
      items={[
        { id: 'edit', label: labels.edit, icon: <Pencil className="size-4" />, onSelect: () => flash(`${labels.edit}: ${row.name}`, 'info') },
        { id: 'duplicate', label: labels.duplicate, icon: <Copy className="size-4" />, onSelect: () => flash(`${labels.duplicate}: ${row.name}`, 'info') },
        { id: 'delete', label: labels.remove, icon: <Trash2 className="size-4" />, destructive: true, onSelect: () => flash(`${labels.remove}: ${row.name}`, 'info') },
      ]}
    />
  )
}

function compareProjects(left: ProjectRow, right: ProjectRow, sorting: SortingState): number {
  for (const rule of sorting) {
    const key = rule.id as keyof ProjectRow
    const leftValue = left[key]
    const rightValue = right[key]
    const order = typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue))
    if (order !== 0) return rule.desc ? -order : order
  }
  return 0
}

function matchesSearch(row: ProjectRow, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [row.name, row.owner, row.client].some((value) => value.toLowerCase().includes(needle))
}

function selectedFilterValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  return typeof value === 'string' && value.length > 0 ? [value] : []
}

export function DataTableBasicExample() {
  const labels = useProjectLabels()
  const columns = React.useMemo(() => baseColumns(labels), [labels])
  return (
    <div className="w-full">
      <DataTable<ProjectRow>
        title={labels.title}
        actions={<CreateProjectButton label={labels.create} />}
        columns={columns}
        data={SHORT_ROWS}
      />
    </div>
  )
}

export function DataTableSortingPaginationExample() {
  const labels = useProjectLabels()
  const columns = React.useMemo(() => baseColumns(labels), [labels])
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(5)
  const sortedRows = React.useMemo(
    () => [...PROJECT_ROWS].sort((left, right) => compareProjects(left, right, sorting)),
    [sorting],
  )
  const pageRows = sortedRows.slice((page - 1) * pageSize, page * pageSize)
  return (
    <div className="w-full">
      <DataTable<ProjectRow>
        title={labels.title}
        columns={columns}
        data={pageRows}
        sortable
        manualSorting
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next)
          setPage(1)
        }}
        showQueryTime={false}
        pagination={{
          page,
          pageSize,
          total: sortedRows.length,
          totalPages: Math.max(1, Math.ceil(sortedRows.length / pageSize)),
          onPageChange: setPage,
          pageSizeOptions: [5, 10],
          onPageSizeChange: (next) => {
            setPageSize(next)
            setPage(1)
          },
        }}
      />
    </div>
  )
}

export function DataTableSearchFiltersExample() {
  const labels = useProjectLabels()
  const columns = React.useMemo(() => baseColumns(labels), [labels])
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: labels.statusHeader,
        type: 'select',
        options: PROJECT_STATUSES.map((status) => ({ value: status, label: labels.status[status] })),
      },
      {
        id: 'region',
        label: labels.regionHeader,
        type: 'select',
        options: PROJECT_REGIONS.map((region) => ({ value: region, label: labels.region[region] })),
      },
    ],
    [labels],
  )
  const rows = React.useMemo(() => {
    const statuses = selectedFilterValues(filterValues.status)
    const regions = selectedFilterValues(filterValues.region)
    return PROJECT_ROWS.filter((row) => {
      if (!matchesSearch(row, search)) return false
      if (statuses.length > 0 && !statuses.includes(row.status)) return false
      if (regions.length > 0 && !regions.includes(row.region)) return false
      return true
    })
  }, [filterValues, search])
  return (
    <div className="w-full">
      <DataTable<ProjectRow>
        title={labels.title}
        columns={columns}
        data={rows}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={labels.searchPlaceholder}
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={setFilterValues}
        onFiltersClear={() => setFilterValues({})}
      />
    </div>
  )
}

export function DataTableRowActionsExample() {
  const labels = useProjectLabels()
  const t = useT()
  const columns = React.useMemo(() => baseColumns(labels), [labels])
  return (
    <div className="w-full">
      <DataTable<ProjectRow>
        title={labels.title}
        columns={columns}
        data={SHORT_ROWS}
        onRowClick={(row) =>
          flash(t('design_system.gallery.samples.dataTable.opened', 'Opened {name}', { name: row.name }), 'info')
        }
        rowActions={(row) => projectRowActions(labels, row)}
      />
    </div>
  )
}

export function DataTableBulkActionsExample() {
  const labels = useProjectLabels()
  const t = useT()
  const columns = React.useMemo(() => baseColumns(labels), [labels])
  const [rows, setRows] = React.useState<ProjectRow[]>(() => PROJECT_ROWS.slice(0, 6))
  const bulkActions = React.useMemo<BulkAction<ProjectRow>[]>(
    () => [
      {
        id: 'complete',
        label: labels.markCompleted,
        icon: CheckCircle2,
        onExecute: (selected) => {
          const ids = new Set(selected.map((row) => row.id))
          setRows((current) => current.map((row) => (ids.has(row.id) ? { ...row, status: 'completed' } : row)))
          return {
            ok: true,
            affectedCount: selected.length,
            message: t('design_system.gallery.samples.dataTable.bulkCompleted', '{count} projects marked completed', { count: selected.length }),
          }
        },
      },
      {
        id: 'delete',
        label: labels.remove,
        icon: Trash2,
        destructive: true,
        onExecute: (selected) => {
          const ids = new Set(selected.map((row) => row.id))
          setRows((current) => current.filter((row) => !ids.has(row.id)))
          return {
            ok: true,
            affectedCount: selected.length,
            message: t('design_system.gallery.samples.dataTable.bulkDeleted', '{count} projects deleted', { count: selected.length }),
          }
        },
      },
    ],
    [labels, t],
  )
  return (
    <div className="w-full">
      <DataTable<ProjectRow> title={labels.title} columns={columns} data={rows} bulkActions={bulkActions} />
    </div>
  )
}

export function DataTablePinnedColumnsExample() {
  const labels = useProjectLabels()
  const columns = React.useMemo(() => wideColumns(labels), [labels])
  return (
    <div className="w-full max-w-5xl">
      <DataTable<ProjectRow>
        title={labels.title}
        columns={columns}
        data={PROJECT_ROWS.slice(0, 6)}
        stickyFirstColumn
        stickyActionsColumn
        rowActions={(row) => projectRowActions(labels, row)}
      />
    </div>
  )
}

export function DataTableEmbeddedExample() {
  const labels = useProjectLabels()
  const columns = React.useMemo(() => baseColumns(labels), [labels])
  const rows = React.useMemo(() => PROJECT_ROWS.filter((row) => row.client === 'Tidewater Freight'), [])
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{labels.embeddedTitle}</CardTitle>
        <CardDescription>{labels.embeddedDescription}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <DataTable<ProjectRow> embedded columns={columns} data={rows} />
      </CardContent>
    </Card>
  )
}

export function DataTableLoadingExample() {
  const labels = useProjectLabels()
  const columns = React.useMemo(() => baseColumns(labels), [labels])
  return (
    <div className="w-full">
      <DataTable<ProjectRow> title={labels.title} columns={columns} data={[]} isLoading />
    </div>
  )
}

export function DataTableEmptyExample() {
  const labels = useProjectLabels()
  const columns = React.useMemo(() => baseColumns(labels), [labels])
  return (
    <div className="w-full">
      <DataTable<ProjectRow>
        title={labels.title}
        columns={columns}
        data={[]}
        emptyState={
          <ListEmptyState
            entityName={labels.entityPlural}
            createLabel={labels.create}
            onCreate={() => flash(labels.create, 'info')}
          />
        }
      />
    </div>
  )
}

export function DataTableNoResultsExample() {
  const labels = useProjectLabels()
  const columns = React.useMemo(() => baseColumns(labels), [labels])
  const [search, setSearch] = React.useState('zeppelin')
  const rows = React.useMemo(() => PROJECT_ROWS.filter((row) => matchesSearch(row, search)).slice(0, 5), [search])
  return (
    <div className="w-full">
      <DataTable<ProjectRow>
        title={labels.title}
        columns={columns}
        data={rows}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={labels.searchPlaceholder}
      />
    </div>
  )
}

export function DataTableErrorExample() {
  const labels = useProjectLabels()
  const columns = React.useMemo(() => baseColumns(labels), [labels])
  const [failed, setFailed] = React.useState(true)
  return (
    <div className="w-full">
      <DataTable<ProjectRow>
        title={labels.title}
        columns={columns}
        data={failed ? [] : SHORT_ROWS}
        error={failed ? labels.loadError : null}
        refreshButton={{ label: labels.refresh, onRefresh: () => setFailed((current) => !current) }}
      />
    </div>
  )
}

const IMPORT_LINE = `import { DataTable } from '@open-mercato/ui/backend/DataTable'`

const COLUMNS_SNIPPET = `type ProjectRow = { id: string; name: string; owner: string; status: ProjectStatus; budget: number; dueDate: string }

const columns: ColumnDef<ProjectRow>[] = [
  { accessorKey: 'name', header: t('projects.list.columns.name') },
  { accessorKey: 'owner', header: t('projects.list.columns.owner') },
  {
    accessorKey: 'status',
    header: t('projects.list.columns.status'),
    cell: ({ row }) => (
      <StatusBadge variant={statusVariants[row.original.status]} dot>
        {t(\`projects.status.\${row.original.status}\`)}
      </StatusBadge>
    ),
  },
  { accessorKey: 'budget', header: t('projects.list.columns.budget') },
  { accessorKey: 'dueDate', header: t('projects.list.columns.dueDate') },
]`

export const dataTableBasicCode = `import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Plus } from 'lucide-react'
${IMPORT_LINE}
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'

${COLUMNS_SNIPPET}

<DataTable<ProjectRow>
  title={t('projects.list.title')}
  actions={
    <Button size="sm" onClick={openCreateDialog}>
      <Plus className="size-4" aria-hidden />
      {t('projects.list.create')}
    </Button>
  }
  columns={columns}
  data={rows}
/>`

export const dataTableSortingPaginationCode = `import type { SortingState } from '@tanstack/react-table'
${IMPORT_LINE}

const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
const [page, setPage] = React.useState(1)
const [pageSize, setPageSize] = React.useState(5)

const sortedRows = React.useMemo(() => sortRows(allRows, sorting), [allRows, sorting])
const pageRows = sortedRows.slice((page - 1) * pageSize, page * pageSize)

<DataTable<ProjectRow>
  title={t('projects.list.title')}
  columns={columns}
  data={pageRows}
  sortable
  manualSorting
  sorting={sorting}
  onSortingChange={(next) => {
    setSorting(next)
    setPage(1)
  }}
  showQueryTime={false}
  pagination={{
    page,
    pageSize,
    total: sortedRows.length,
    totalPages: Math.max(1, Math.ceil(sortedRows.length / pageSize)),
    onPageChange: setPage,
    pageSizeOptions: [5, 10],
    onPageSizeChange: (next) => {
      setPageSize(next)
      setPage(1)
    },
  }}
/>`

export const dataTableSearchFiltersCode = `${IMPORT_LINE}
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

const [search, setSearch] = React.useState('')
const [filterValues, setFilterValues] = React.useState<FilterValues>({})

const filters: FilterDef[] = [
  { id: 'status', label: t('projects.list.columns.status'), type: 'select', options: statusOptions },
  { id: 'region', label: t('projects.list.columns.region'), type: 'select', options: regionOptions },
]

const rows = React.useMemo(
  () => allRows.filter((row) => matchesSearch(row, search) && matchesFilters(row, filterValues)),
  [allRows, search, filterValues],
)

<DataTable<ProjectRow>
  title={t('projects.list.title')}
  columns={columns}
  data={rows}
  searchValue={search}
  onSearchChange={setSearch}
  searchPlaceholder={t('projects.list.search')}
  filters={filters}
  filterValues={filterValues}
  onFiltersApply={setFilterValues}
  onFiltersClear={() => setFilterValues({})}
/>`

export const dataTableRowActionsCode = `import { Copy, Pencil, Trash2 } from 'lucide-react'
${IMPORT_LINE}
import { RowActions } from '@open-mercato/ui/backend/RowActions'

<DataTable<ProjectRow>
  title={t('projects.list.title')}
  columns={columns}
  data={rows}
  onRowClick={(row) => router.push(\`/backend/projects/\${row.id}\`)}
  rowActions={(row) => (
    <RowActions
      items={[
        { id: 'edit', label: t('projects.list.actions.edit'), icon: <Pencil className="size-4" />, href: \`/backend/projects/\${row.id}/edit\` },
        { id: 'duplicate', label: t('projects.list.actions.duplicate'), icon: <Copy className="size-4" />, onSelect: () => duplicateProject(row) },
        { id: 'delete', label: t('projects.list.actions.delete'), icon: <Trash2 className="size-4" />, destructive: true, onSelect: () => deleteProject(row) },
      ]}
    />
  )}
/>`

export const dataTableBulkActionsCode = `import { CheckCircle2, Trash2 } from 'lucide-react'
import { DataTable, type BulkAction } from '@open-mercato/ui/backend/DataTable'

const bulkActions: BulkAction<ProjectRow>[] = [
  {
    id: 'complete',
    label: t('projects.list.bulk.complete'),
    icon: CheckCircle2,
    onExecute: async (selected) => {
      await completeProjects(selected.map((row) => row.id))
      return { ok: true, affectedCount: selected.length, message: t('projects.list.bulk.completed', { count: selected.length }) }
    },
  },
  {
    id: 'delete',
    label: t('projects.list.bulk.delete'),
    icon: Trash2,
    destructive: true,
    onExecute: async (selected) => {
      await deleteProjects(selected.map((row) => row.id))
      return { ok: true, affectedCount: selected.length, message: t('projects.list.bulk.deleted', { count: selected.length }) }
    },
  },
]

<DataTable<ProjectRow> title={t('projects.list.title')} columns={columns} data={rows} bulkActions={bulkActions} />`

export const dataTablePinnedColumnsCode = `${IMPORT_LINE}
import { RowActions } from '@open-mercato/ui/backend/RowActions'

<DataTable<ProjectRow>
  title={t('projects.list.title')}
  columns={wideColumns}
  data={rows}
  stickyFirstColumn
  stickyActionsColumn
  rowActions={(row) => <RowActions items={buildRowActions(row)} />}
/>`

export const dataTableEmbeddedCode = `${IMPORT_LINE}
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'

<Card>
  <CardHeader>
    <CardTitle>{t('clients.detail.projects.title')}</CardTitle>
    <CardDescription>{t('clients.detail.projects.description')}</CardDescription>
  </CardHeader>
  <CardContent className="overflow-x-auto">
    <DataTable<ProjectRow> embedded columns={columns} data={clientProjects} />
  </CardContent>
</Card>`

export const dataTableLoadingCode = `${IMPORT_LINE}

<DataTable<ProjectRow> title={t('projects.list.title')} columns={columns} data={rows} isLoading={isLoading} />`

export const dataTableEmptyCode = `${IMPORT_LINE}
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'

<DataTable<ProjectRow>
  title={t('projects.list.title')}
  columns={columns}
  data={rows}
  emptyState={
    <ListEmptyState
      entityName={t('projects.list.entityPlural')}
      createLabel={t('projects.list.create')}
      onCreate={openCreateDialog}
    />
  }
/>`

export const dataTableNoResultsCode = `${IMPORT_LINE}

const [search, setSearch] = React.useState('zeppelin')
const rows = React.useMemo(() => allRows.filter((row) => matchesSearch(row, search)), [allRows, search])

<DataTable<ProjectRow>
  title={t('projects.list.title')}
  columns={columns}
  data={rows}
  searchValue={search}
  onSearchChange={setSearch}
  searchPlaceholder={t('projects.list.search')}
/>`

export const dataTableErrorCode = `${IMPORT_LINE}

<DataTable<ProjectRow>
  title={t('projects.list.title')}
  columns={columns}
  data={rows}
  error={loadFailed ? t('projects.list.loadError') : null}
  refreshButton={{ label: t('projects.list.reload'), onRefresh: reload, isRefreshing: isLoading }}
/>`
