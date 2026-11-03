"use client"
import * as React from 'react'
import { extensionPoints } from '@open-mercato/core/modules/query_index/extension-points'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('query_index').child({ component: 'indexes-table' })

const MUTATION_CONTEXT_ID = 'query_index.status.list:actions'

type Translator = (key: string, params?: Record<string, string | number>) => string

type PartitionStatus = {
  partitionIndex: number | null
  partitionCount: number | null
  status: 'reindexing' | 'purging' | 'stalled' | 'completed' | 'failed'
  processedCount?: number | null
  totalCount?: number | null
  heartbeatAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

type JobStatus = {
  status: 'idle' | 'reindexing' | 'purging' | 'stalled' | 'failed'
  startedAt?: string | null
  finishedAt?: string | null
  heartbeatAt?: string | null
  processedCount?: number | null
  totalCount?: number | null
  partitions?: PartitionStatus[]
  scope?: {
    status?: 'reindexing' | 'purging' | 'stalled' | 'completed' | 'failed' | null
    processedCount?: number | null
    totalCount?: number | null
  } | null
}

type Row = {
  entityId: string
  label: string
  baseCount: number | null
  indexCount: number | null
  vectorCount: number | null
  /** The entity is configured for vector search (declares `buildSource`). */
  vectorEnabled: boolean
  /** Vector indexing can actually run — provider reachable and auto-indexing on. */
  vectorIndexingActive?: boolean
  fulltextCount: number | null
  fulltextEnabled: boolean
  hasCustomFields?: boolean
  /** Legacy aggregate: query index AND vector coverage. Preserved for API consumers. */
  ok: boolean
  /** Query index alone is in sync with the base table — the signal this page reports. */
  queryIndexOk?: boolean
  job?: JobStatus
}

type Resp = { items: Row[] }

const BACKEND_FILTER_ID = 'backend'
// Kept at or below the repository-wide 100-row cap; the entity list grows with every
// installed module, so it cannot be allowed to scale with the row count.
const PAGE_SIZE = 50

/** Sort key for a column id. Mirrors the column `accessorFn`s so paging and sorting agree. */
function sortValue(row: Row, columnId: string): string | number {
  if (columnId === 'entityId') return row.entityId
  if (columnId === 'baseCount') return row.baseCount ?? 0
  if (columnId === 'indexCount') return row.indexCount ?? 0
  if (columnId === 'vectorCount') return isVectorReportable(row) ? row.vectorCount ?? 0 : -1
  if (columnId === 'fulltextCount') return row.fulltextEnabled ? row.fulltextCount ?? 0 : -1
  return row.entityId
}

type BackendFilter = 'vector' | 'fulltext' | 'custom_fields'

/**
 * Vector coverage is only worth showing when embeddings can actually be written; otherwise
 * the count is a permanent 0 that reads as a gap. Older payloads without the flag are
 * treated as active so the column keeps working against an un-upgraded server.
 */
function isVectorReportable(row: Row): boolean {
  return row.vectorEnabled && (row.vectorIndexingActive ?? true)
}

function matchesBackendFilter(row: Row, backend: BackendFilter): boolean {
  if (backend === 'vector') return row.vectorEnabled
  if (backend === 'fulltext') return row.fulltextEnabled
  return Boolean(row.hasCustomFields)
}

function formatCount(value: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString()
}

function formatNumeric(value: number | null | undefined): string | null {
  if (value == null) return null
  return Number(value).toLocaleString()
}

function formatProgressLabel(
  processed: number | null | undefined,
  total: number | null | undefined,
  t: Translator,
): string | null {
  const processedText = formatNumeric(processed)
  if (!processedText) return null
  const totalText = formatNumeric(total)
  if (totalText) return t('query_index.table.status.progress', { processed: processedText, total: totalText })
  return t('query_index.table.status.progressSingle', { processed: processedText })
}

function translateJobStatus(
  t: Translator,
  status: JobStatus['status'] | undefined,
  ok: boolean,
  measured: boolean,
): string {
  const idleLabel = () => {
    // No coverage snapshot yet — an async refresh is pending, so the index is not known to
    // be out of sync. Saying so would be the same false alarm this page used to raise.
    if (!measured) return t('query_index.table.status.not_measured')
    return ok ? t('query_index.table.status.in_sync') : t('query_index.table.status.out_of_sync')
  }
  if (!status || status === 'idle') return idleLabel()
  if (status === 'reindexing') return t('query_index.table.status.reindexing')
  if (status === 'purging') return t('query_index.table.status.purging')
  if (status === 'stalled') return t('query_index.table.status.stalled')
  if (status === 'failed') return t('query_index.table.status.failed')
  return idleLabel()
}

function translateScopeStatus(
  t: Translator,
  status: PartitionStatus['status'] | JobStatus['status'] | undefined | null,
): string {
  if (status === 'reindexing') return t('query_index.table.status.scope.reindexing')
  if (status === 'purging') return t('query_index.table.status.scope.purging')
  if (status === 'stalled') return t('query_index.table.status.scope.stalled')
  if (status === 'failed') return t('query_index.table.status.scope.failed')
  return t('query_index.table.status.scope.completed')
}


function createColumns(t: Translator): ColumnDef<Row>[] {
  return [
    {
      id: 'entityId',
      header: () => t('query_index.table.columns.entity'),
      accessorKey: 'entityId',
      // The entity id is the only identifier on this page and ids run to ~45 characters
      // (`catalog:catalog_product_category_assignment`). DataTable's default 150px clamp
      // ellipsised them into indistinguishable `customers:customer…` rows.
      meta: { priority: 1, maxWidth: '340px' },
    },
    {
      id: 'baseCount',
      header: () => t('query_index.table.columns.records'),
      accessorFn: (row) => row.baseCount ?? 0,
      cell: ({ row }) => <span>{formatCount(row.original.baseCount)}</span>,
      meta: { priority: 2 },
    },
    {
      id: 'indexCount',
      header: () => t('query_index.table.columns.indexed'),
      accessorFn: (row) => row.indexCount ?? 0,
      cell: ({ row }) => <span>{formatCount(row.original.indexCount)}</span>,
      meta: { priority: 2 },
    },
    {
      id: 'vectorCount',
      header: () => t('query_index.table.columns.vector'),
      accessorFn: (row) => (isVectorReportable(row) ? row.vectorCount ?? 0 : -1),
      cell: ({ row }) => {
        const record = row.original
        if (!isVectorReportable(record)) return <span>—</span>
        const ok = record.vectorCount != null && record.baseCount != null && record.vectorCount === record.baseCount
        const display = formatCount(record.vectorCount)
        const className = ok ? 'text-status-success-text' : 'text-status-warning-text'
        return <span className={className}>{display}</span>
      },
      meta: { priority: 2 },
    },
    {
      id: 'fulltextCount',
      header: () => t('query_index.table.columns.fulltext'),
      accessorFn: (row) => (row.fulltextEnabled ? row.fulltextCount ?? 0 : -1),
      cell: ({ row }) => {
        const record = row.original
        if (!record.fulltextEnabled) return <span>—</span>
        const ok = record.fulltextCount != null && record.baseCount != null && record.fulltextCount === record.baseCount
        const display = formatCount(record.fulltextCount)
        const className = ok ? 'text-status-success-text' : 'text-status-warning-text'
        return <span className={className}>{display}</span>
      },
      meta: { priority: 2 },
    },
    {
      id: 'status',
      header: () => t('query_index.table.columns.status'),
      cell: ({ row }) => {
        const record = row.original
        const job = record.job
        const partitions = job?.partitions ?? []
        const measured = record.baseCount != null || record.indexCount != null

        // A non-partitioned reindex — and every purge, which never partitions
        // (`lib/purge.ts` always passes `partitionIndex: null`) — is tracked as a scope row.
        // The server derives the top-level status from partition rows only, so it reports
        // `idle` for those runs; without folding the scope row in, the default reindex and
        // every purge would render as though nothing were happening.
        const scopeStatus = job?.scope?.status ?? null
        const scopeInFlight = scopeStatus != null && scopeStatus !== 'completed'
        const effectiveStatus: JobStatus['status'] | undefined = job
          ? (job.status !== 'idle'
              ? job.status
              : (scopeInFlight ? (scopeStatus as JobStatus['status']) : 'idle'))
          : undefined

        const indexOk = record.queryIndexOk ?? record.ok
        const ok = indexOk && (!job || effectiveStatus === 'idle')
        const jobFailed = effectiveStatus === 'failed'
        const statusText = translateJobStatus(t, effectiveStatus, ok, measured)

        const jobInFlight = Boolean(effectiveStatus && effectiveStatus !== 'idle')
          || partitions.some((part) => part.status !== 'completed')

        // Job counters and index coverage are different numbers: the counters describe the
        // last reindex run, the Records/Indexed columns describe the index right now. While
        // a job runs, "Reindexing (5/14)" is the only place progress is visible. Once it is
        // idle the counters are stale and duplicate the columns — worse, they can contradict
        // them: an entity whose last run processed 14 rows but landed 2 in the index rendered
        // "Out of sync (14/14)" next to Records 14 / Indexed 2.
        const jobProgress = jobInFlight && job
          ? formatProgressLabel(job.processedCount ?? null, job.totalCount ?? null, t)
          : null
        const label = jobProgress
          ? t('query_index.table.status.withProgress', { status: statusText, progress: jobProgress })
          : statusText
        let variant: StatusBadgeVariant = 'neutral'
        if (job) {
          if (effectiveStatus === 'stalled' || jobFailed) variant = 'error'
          else if (effectiveStatus === 'reindexing' || effectiveStatus === 'purging') variant = 'warning'
          else variant = ok ? 'success' : 'neutral'
        } else {
          variant = ok ? 'success' : 'neutral'
        }

        const lines: string[] = []

        // Per-partition detail earns its space only while work is in flight — that is when
        // it tells you which partition is running or stuck. Once the job is idle and every
        // partition is finished, each line just restates the badge, on every row.
        if (jobInFlight) {
          if (job?.scope && partitions.length <= 1) {
            const scopeStatusText = translateScopeStatus(t, scopeStatus)
            const scopeProgress = formatProgressLabel(job.scope.processedCount ?? null, job.scope.totalCount ?? null, t)
            const scopeLabel = t('query_index.table.status.scopeLabel')
            lines.push(`${scopeLabel}: ${scopeStatusText}${scopeProgress ? ` (${scopeProgress})` : ''}`)
          }

          if (partitions.length > 1) {
            for (const part of partitions) {
              const partitionLabel =
                part.partitionIndex != null
                  ? t('query_index.table.status.partitionLabel', { index: Number(part.partitionIndex) + 1 })
                  : t('query_index.table.status.scopeLabel')
              const partitionStatus = translateScopeStatus(t, part.status)
              const partitionProgress = formatProgressLabel(part.processedCount ?? null, part.totalCount ?? null, t)
              lines.push(`${partitionLabel}: ${partitionStatus}${partitionProgress ? ` (${partitionProgress})` : ''}`)
            }
          }
        }

        return (
          <div className="space-y-1.5">
            <div>
              <StatusBadge variant={variant} dot>
                {label}
              </StatusBadge>
            </div>
            {lines.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {lines.map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
              </div>
            )}
          </div>
        )
      },
      meta: { priority: 1 },
    },
  ]
}

export default function QueryIndexesTable() {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'entityId', desc: false }])
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [refreshSeq, setRefreshSeq] = React.useState(0)
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const columns = React.useMemo(() => createColumns(t), [t])
  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: BACKEND_FILTER_ID,
      label: t('query_index.table.filters.backend'),
      type: 'select',
      options: [
        { label: t('query_index.table.filters.backendOptions.vector'), value: 'vector' },
        { label: t('query_index.table.filters.backendOptions.fulltext'), value: 'fulltext' },
        { label: t('query_index.table.filters.backendOptions.customFields'), value: 'custom_fields' },
      ],
    },
  ], [t])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ['query-index-status', scopeVersion, refreshSeq],
    queryFn: async () => {
      const baseUrl = '/api/query_index/status'
      const url = refreshSeq > 0 ? `${baseUrl}?refresh=${refreshSeq}` : baseUrl
      return readApiResultOrThrow<Resp>(
        url,
        undefined,
        { errorMessage: t('query_index.table.errors.loadFailed') },
      )
    },
    refetchInterval: 4000,
  })

  const rowsAll = data?.items || []
  const matchedRows = React.useMemo(() => {
    const backend = filterValues[BACKEND_FILTER_ID] as BackendFilter | undefined
    const q = search.trim().toLowerCase()
    if (!q && !backend) return rowsAll
    return rowsAll.filter((row) => {
      if (q && !row.entityId.toLowerCase().includes(q)) return false
      if (backend && !matchesBackendFilter(row, backend)) return false
      return true
    })
  }, [rowsAll, search, filterValues])

  // The endpoint returns every entity in one payload, so paging is ours to do. Sorting has
  // to happen here rather than in the table: slicing first would let DataTable sort only the
  // visible page, so page 2 would not hold the rows that sort into it.
  const sortedRows = React.useMemo(() => {
    const sort = sorting[0]
    if (!sort) return matchedRows
    const direction = sort.desc ? -1 : 1
    return [...matchedRows].sort((a, b) => {
      const left = sortValue(a, sort.id)
      const right = sortValue(b, sort.id)
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left).localeCompare(String(right)) * direction
      }
      return (Number(left) - Number(right)) * direction
    })
  }, [matchedRows, sorting])

  const total = sortedRows.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const rows = React.useMemo(
    () => sortedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [sortedRows, currentPage],
  )

  const pagination = React.useMemo(() => ({
    page: currentPage,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
    onPageChange: setPage,
  }), [currentPage, total, totalPages])

  const trigger = React.useCallback(
    async (action: 'reindex' | 'purge', entityId: string, opts?: { force?: boolean }) => {
      const body: Record<string, unknown> = { entityType: entityId }
      if (opts?.force) body.force = true
      const actionLabel =
        action === 'purge' ? t('query_index.table.actions.purge') : t('query_index.table.actions.reindex')
      const errorMessage = t('query_index.table.errors.actionFailed', { action: actionLabel })
      try {
        await runMutation({
          operation: () =>
            apiCallOrThrow(`/api/query_index/${action}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }, { errorMessage }),
          context: {
            formId: MUTATION_CONTEXT_ID,
            resourceKind: 'query_index',
            resourceId: entityId,
            retryLastMutation,
          },
          mutationPayload: { action, entityType: entityId, force: Boolean(opts?.force) },
        })
      } catch (err) {
        // Expected operational failures (e.g. a 503 when a search backend is not
        // configured) — surface a flash toast, not an alert or an error-level
        // stack dump that reads like an unhandled exception.
        const message = err instanceof Error && err.message ? err.message : errorMessage
        logger.warn('Index action failed', { message })
        flash(message, 'error')
      }
      qc.invalidateQueries({ queryKey: ['query-index-status'] })
    },
    [qc, t, runMutation, retryLastMutation],
  )

  const triggerVector = React.useCallback(
    async (action: 'reindex' | 'purge', entityId: string) => {
      if (action === 'purge') {
        const confirmed = await confirm({
          title: t('query_index.table.confirm.vectorPurge'),
          variant: 'destructive',
        })
        if (!confirmed) return
      }

      const actionLabel = action === 'purge'
        ? t('query_index.table.actions.vectorPurge')
        : t('query_index.table.actions.vectorReindex')
      const errorMessage = t('query_index.table.errors.actionFailed', { action: actionLabel })
      try {
        await runMutation({
          operation: () =>
            apiCallOrThrow('/api/search/embeddings/reindex', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                entityId,
                purgeFirst: action === 'purge',
              }),
            }, { errorMessage }),
          context: {
            formId: MUTATION_CONTEXT_ID,
            resourceKind: 'query_index.vector',
            resourceId: entityId,
            retryLastMutation,
          },
          mutationPayload: { action, entityId, purgeFirst: action === 'purge' },
        })
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : errorMessage
        logger.warn('Vector action failed', { message })
        flash(message, 'error')
      }
      qc.invalidateQueries({ queryKey: ['query-index-status'] })
    },
    [confirm, qc, t, runMutation, retryLastMutation],
  )

  const triggerFulltext = React.useCallback(
    async (action: 'reindex' | 'purge', entityId: string) => {
      if (action === 'purge') {
        const confirmed = await confirm({
          title: t('query_index.table.confirm.fulltextPurge'),
          variant: 'destructive',
        })
        if (!confirmed) return
      }

      const actionLabel = action === 'purge'
        ? t('query_index.table.actions.fulltextPurge')
        : t('query_index.table.actions.fulltextReindex')
      const errorMessage = t('query_index.table.errors.actionFailed', { action: actionLabel })
      try {
        await runMutation({
          operation: () =>
            apiCallOrThrow('/api/search/reindex', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                action: action === 'purge' ? 'clear' : 'reindex',
                entityId,
              }),
            }, { errorMessage }),
          context: {
            formId: MUTATION_CONTEXT_ID,
            resourceKind: 'query_index.fulltext',
            resourceId: entityId,
            retryLastMutation,
          },
          mutationPayload: { action, entityId },
        })
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : errorMessage
        logger.warn('Fulltext action failed', { message })
        flash(message, 'error')
      }
      qc.invalidateQueries({ queryKey: ['query-index-status'] })
    },
    [confirm, qc, t, runMutation, retryLastMutation],
  )

  return (
    <>
      <DataTable
      title={t('query_index.nav.queryIndexes')}
      titleHeadingLevel={1}
        actions={(
          <>
            <Button
              variant="outline"
              onClick={() => {
                setRefreshSeq((v) => v + 1)
                qc.invalidateQueries({ queryKey: ['query-index-status'] })
              }}
            >
              {t('query_index.table.refresh')}
            </Button>
          </>
        )}
        columns={columns}
        data={rows}
        searchValue={search}
        searchPlaceholder={t('query_index.table.searchPlaceholder')}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={(values) => {
          setFilterValues(values)
          setPage(1)
        }}
        onFiltersClear={() => {
          setFilterValues({})
          setPage(1)
        }}
        sortable
        manualSorting
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next)
          setPage(1)
        }}
        perspective={{ tableId: extensionPoints.hosts.statusTable.tableId }}
        rowActions={(row) => {
          const items: Array<{ id: string; label: string; onSelect: () => void; destructive?: boolean }> = [
            { id: 'reindex', label: t('query_index.table.actions.reindex'), onSelect: () => void trigger('reindex', row.entityId) },
            {
              id: 'reindex-force',
              label: t('query_index.table.actions.reindexForce'),
              onSelect: () => void trigger('reindex', row.entityId, { force: true }),
            },
            {
              id: 'purge',
              label: t('query_index.table.actions.purge'),
              destructive: true,
              onSelect: () => void trigger('purge', row.entityId),
            },
          ]

          // Manual vector actions stay available whenever the entity declares `buildSource`,
          // even when auto-indexing is off — a manual reindex is still a valid operation.
          if (row.vectorEnabled) {
            items.push(
              {
                id: 'vector-reindex',
                label: t('query_index.table.actions.vectorReindex'),
                onSelect: () => void triggerVector('reindex', row.entityId),
              },
              {
                id: 'vector-purge',
                label: t('query_index.table.actions.vectorPurge'),
                destructive: true,
                onSelect: () => void triggerVector('purge', row.entityId),
              },
            )
          }

          if (row.fulltextEnabled) {
            items.push(
              {
                id: 'fulltext-reindex',
                label: t('query_index.table.actions.fulltextReindex'),
                onSelect: () => void triggerFulltext('reindex', row.entityId),
              },
              {
                id: 'fulltext-purge',
                label: t('query_index.table.actions.fulltextPurge'),
                destructive: true,
                onSelect: () => void triggerFulltext('purge', row.entityId),
              },
            )
          }

          return <RowActions items={items} />
        }}
        pagination={pagination}
        isLoading={isLoading}
      />
      {ConfirmDialogElement}
    </>
  )
}
