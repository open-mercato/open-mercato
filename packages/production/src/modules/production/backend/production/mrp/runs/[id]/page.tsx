'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { ColumnDef } from '@tanstack/react-table'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Download } from 'lucide-react'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { BulkAction } from '@open-mercato/ui/backend/DataTable'
import {
  MrpRunStatusBadge,
  MrpSuggestionStatusBadge,
  MrpSuggestionTypeBadge,
  type MrpRunStatus,
  type MrpSuggestionStatus,
  type MrpSuggestionType,
} from '../../../components/MrpBadges'
import { extractServerErrorMessage } from '../../../../../lib/serverErrorMessage.js'

type MrpPeggingRef = {
  productKey: string
  source: { type: string; id?: string | null }
  qty: number
}

type MrpSuggestionRow = {
  id: string
  runId: string
  suggestionType: MrpSuggestionType
  productId: string
  variantId: string | null
  qty: string
  uom: string
  dueDate: string
  demandSource: MrpPeggingRef[] | null
  status: MrpSuggestionStatus
  carriedFromSuggestionId: string | null
  createdAt: string
}

type SuggestionsResponsePayload = {
  items: MrpSuggestionRow[]
  total: number
  page: number
  pageSize: number
}

type MrpRunRow = {
  id: string
  status: MrpRunStatus
  startedAt: string | null
  finishedAt: string | null
}

const SUGGESTION_STATUSES: MrpSuggestionStatus[] = ['open', 'accepted', 'dismissed', 'superseded']
const SUGGESTION_TYPES: MrpSuggestionType[] = ['make', 'buy', 'reschedule', 'cancel']

function peggingSummary(pegging: MrpPeggingRef[] | null): string {
  if (!pegging || pegging.length === 0) return ''
  return pegging.map((ref) => `${ref.source.type}${ref.source.id ? ` (${ref.source.id})` : ''}: ${ref.qty}`).join('\n')
}

/**
 * MRP run suggestions (task 5.4): the planista's action surface for a single
 * run's `make`/`buy`/`reschedule`/`cancel` suggestions. Default
 * `status=open` filter mirrors the API route's own default (spec § MRP
 * engine carry-over — `superseded` rows never show unless explicitly asked
 * for, see `api/mrp/runs/[id]/suggestions/route.ts`).
 */
export default function MrpRunSuggestionsPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const runId = params?.id ?? ''

  const [run, setRun] = React.useState<MrpRunRow | null>(null)
  const [runLoading, setRunLoading] = React.useState(true)
  const [runError, setRunError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const [rows, setRows] = React.useState<MrpSuggestionRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [filters, setFilters] = React.useState<FilterValues>({ status: 'open' })
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const bulkMutationContextId = 'production-mrp-suggestions:bulk-action'
  const { runMutation: runBulkMutation, retryLastMutation: retryBulkMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: bulkMutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const singleMutationContextId = 'production-mrp-suggestions:single-action'
  const { runMutation: runSingleMutation, retryLastMutation: retrySingleMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: singleMutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    let cancelled = false
    async function loadRun() {
      if (!runId) return
      setRunLoading(true)
      try {
        const call = await apiCall<{ items: MrpRunRow[] }>(`/api/production/mrp/runs?id=${runId}`)
        if (cancelled) return
        if (call.ok && call.result && call.result.items.length > 0) {
          setRun(call.result.items[0])
        } else if (!call.ok) {
          setRunError(t('production.mrp.error.run_load_failed', 'Failed to load MRP run'))
        } else {
          setIsNotFound(true)
        }
      } catch {
        if (!cancelled) setRunError(t('production.mrp.error.run_load_failed', 'Failed to load MRP run'))
      } finally {
        if (!cancelled) setRunLoading(false)
      }
    }
    loadRun()
    return () => {
      cancelled = true
    }
  }, [runId, t])

  React.useEffect(() => {
    let cancelled = false
    async function loadSuggestions() {
      if (!runId) return
      setIsLoading(true)
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: '20' })
        const statusFilter = filters.status
        params.set('status', typeof statusFilter === 'string' && statusFilter ? statusFilter : 'open')
        if (filters.suggestionType) params.set('suggestionType', String(filters.suggestionType))

        const fallback: SuggestionsResponsePayload = { items: [], total: 0, page, pageSize: 20 }
        const call = await apiCall<SuggestionsResponsePayload>(
          `/api/production/mrp/runs/${runId}/suggestions?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          if (!cancelled) flash(t('production.mrp.error.suggestions_load_failed', 'Failed to load MRP suggestions'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
        }
      } catch {
        if (!cancelled) flash(t('production.mrp.error.suggestions_load_failed', 'Failed to load MRP suggestions'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    loadSuggestions()
    return () => {
      cancelled = true
    }
  }, [runId, page, filters, reloadToken, t])

  const acceptIds = React.useCallback(
    async (ids: string[]) => {
      const result = await runBulkMutation({
        operation: async () => {
          const call = await apiCall<{ acceptedIds: string[]; createdOrderIds: string[]; skippedIds: string[] }>(
            '/api/production/mrp/suggestions/accept',
            { method: 'POST', body: JSON.stringify({ ids }) },
          )
          if (!call.ok) {
            throw Object.assign(new Error('[internal] production.mrp.acceptSuggestions failed'), {
              status: call.status,
              ...((call.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return call.result
        },
        context: { formId: bulkMutationContextId, resourceKind: 'production.mrp_suggestion', retryLastMutation: retryBulkMutation },
      })
      return result
    },
    [bulkMutationContextId, retryBulkMutation, runBulkMutation],
  )

  const dismissIds = React.useCallback(
    async (ids: string[]) => {
      const result = await runBulkMutation({
        operation: async () => {
          const call = await apiCall<{ dismissedIds: string[]; skippedIds: string[] }>(
            '/api/production/mrp/suggestions/dismiss',
            { method: 'POST', body: JSON.stringify({ ids }) },
          )
          if (!call.ok) {
            throw Object.assign(new Error('[internal] production.mrp.dismissSuggestions failed'), {
              status: call.status,
              ...((call.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return call.result
        },
        context: { formId: bulkMutationContextId, resourceKind: 'production.mrp_suggestion', retryLastMutation: retryBulkMutation },
      })
      return result
    },
    [bulkMutationContextId, retryBulkMutation, runBulkMutation],
  )

  const handleBulkAccept = React.useCallback(
    async (selectedRows: MrpSuggestionRow[]) => {
      const confirmed = await confirm({
        title: t('production.mrp.confirm.bulk_accept', 'Accept {count} suggestions?', { count: selectedRows.length }),
      })
      if (!confirmed) return false
      try {
        const result = await acceptIds(selectedRows.map((row) => row.id))
        const acceptedCount = result?.acceptedIds.length ?? 0
        const skippedCount = result?.skippedIds.length ?? 0
        if (skippedCount > 0) {
          flash(
            t('production.mrp.success.bulk_accept_partial', '{accepted} accepted, {skipped} already resolved (skipped)', {
              accepted: acceptedCount,
              skipped: skippedCount,
            }),
            'warning',
          )
        } else {
          flash(t('production.mrp.success.bulk_accept', '{count} suggestions accepted', { count: acceptedCount }), 'success')
        }
        setReloadToken((prev) => prev + 1)
        return true
      } catch (err) {
        const serverMessage = extractServerErrorMessage(err)
        flash(serverMessage ?? t('production.mrp.error.accept_failed', 'Failed to accept suggestions'), 'error')
        return false
      }
    },
    [acceptIds, confirm, t],
  )

  const handleBulkDismiss = React.useCallback(
    async (selectedRows: MrpSuggestionRow[]) => {
      const confirmed = await confirm({
        title: t('production.mrp.confirm.bulk_dismiss', 'Dismiss {count} suggestions?', { count: selectedRows.length }),
      })
      if (!confirmed) return false
      try {
        const result = await dismissIds(selectedRows.map((row) => row.id))
        const dismissedCount = result?.dismissedIds.length ?? 0
        const skippedCount = result?.skippedIds.length ?? 0
        if (skippedCount > 0) {
          flash(
            t('production.mrp.success.bulk_dismiss_partial', '{dismissed} dismissed, {skipped} already resolved (skipped)', {
              dismissed: dismissedCount,
              skipped: skippedCount,
            }),
            'warning',
          )
        } else {
          flash(t('production.mrp.success.bulk_dismiss', '{count} suggestions dismissed', { count: dismissedCount }), 'success')
        }
        setReloadToken((prev) => prev + 1)
        return true
      } catch (err) {
        const serverMessage = extractServerErrorMessage(err)
        flash(serverMessage ?? t('production.mrp.error.dismiss_failed', 'Failed to dismiss suggestions'), 'error')
        return false
      }
    },
    [confirm, dismissIds, t],
  )

  const handleSingleAccept = React.useCallback(
    async (row: MrpSuggestionRow) => {
      try {
        await runSingleMutation({
          operation: () => acceptIds([row.id]),
          context: {
            formId: singleMutationContextId,
            resourceKind: 'production.mrp_suggestion',
            resourceId: row.id,
            retryLastMutation: retrySingleMutation,
          },
        })
        flash(t('production.mrp.success.accept', 'Suggestion accepted'), 'success')
        setReloadToken((prev) => prev + 1)
      } catch (err) {
        const serverMessage = extractServerErrorMessage(err)
        flash(serverMessage ?? t('production.mrp.error.accept_failed', 'Failed to accept suggestions'), 'error')
      }
    },
    [acceptIds, retrySingleMutation, runSingleMutation, singleMutationContextId, t],
  )

  const handleSingleDismiss = React.useCallback(
    async (row: MrpSuggestionRow) => {
      try {
        await runSingleMutation({
          operation: () => dismissIds([row.id]),
          context: {
            formId: singleMutationContextId,
            resourceKind: 'production.mrp_suggestion',
            resourceId: row.id,
            retryLastMutation: retrySingleMutation,
          },
        })
        flash(t('production.mrp.success.dismiss', 'Suggestion dismissed'), 'success')
        setReloadToken((prev) => prev + 1)
      } catch (err) {
        const serverMessage = extractServerErrorMessage(err)
        flash(serverMessage ?? t('production.mrp.error.dismiss_failed', 'Failed to dismiss suggestions'), 'error')
      }
    },
    [dismissIds, retrySingleMutation, runSingleMutation, singleMutationContextId, t],
  )

  const handleExportBuyCsv = React.useCallback(() => {
    if (typeof window === 'undefined') return
    window.open('/api/production/mrp/suggestions/export', '_blank', 'noopener,noreferrer')
  }, [])

  const columns = React.useMemo<ColumnDef<MrpSuggestionRow>[]>(
    () => [
      {
        id: 'suggestionType',
        accessorKey: 'suggestionType',
        header: t('production.mrp.suggestion.field.type', 'Type'),
        enableSorting: false,
        cell: ({ row }) => <MrpSuggestionTypeBadge type={row.original.suggestionType} t={t} />,
      },
      { id: 'productId', accessorKey: 'productId', header: t('production.mrp.suggestion.field.product_id', 'Product') },
      {
        id: 'qty',
        accessorKey: 'qty',
        header: t('production.mrp.suggestion.field.qty', 'Qty (UoM)'),
        enableSorting: false,
        cell: ({ row }) => `${row.original.qty} ${row.original.uom}`,
      },
      {
        id: 'dueDate',
        accessorKey: 'dueDate',
        header: t('production.mrp.suggestion.field.due_date', 'Due date'),
        cell: ({ row }) => new Date(row.original.dueDate).toLocaleDateString(),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: t('production.mrp.suggestion.field.status', 'Status'),
        enableSorting: false,
        cell: ({ row }) => <MrpSuggestionStatusBadge status={row.original.status} t={t} />,
      },
      {
        id: 'pegging',
        header: t('production.mrp.suggestion.field.pegging', 'Demand source'),
        enableSorting: false,
        cell: ({ row }) => {
          const summary = peggingSummary(row.original.demandSource)
          if (!summary) return '—'
          return (
            <SimpleTooltip content={<span className="whitespace-pre-line">{summary}</span>}>
              <span className="cursor-help underline decoration-dotted">
                {t('production.mrp.suggestion.pegging_count', '{count} demand source(s)', {
                  count: row.original.demandSource?.length ?? 0,
                })}
              </span>
            </SimpleTooltip>
          )
        },
      },
    ],
    [t],
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('production.mrp.suggestion.filters.status', 'Status'),
        type: 'select',
        options: SUGGESTION_STATUSES.map((status) => ({
          value: status,
          label: t(`production.mrp.suggestion.status.${status}`, status),
        })),
      },
      {
        id: 'suggestionType',
        label: t('production.mrp.suggestion.filters.type', 'Type'),
        type: 'select',
        options: [
          { label: t('production.mrp.suggestion.filters.all', 'All'), value: '' },
          ...SUGGESTION_TYPES.map((suggestionType) => ({
            value: suggestionType,
            label: t(`production.mrp.suggestion.type.${suggestionType}`, suggestionType),
          })),
        ],
      },
    ],
    [t],
  )

  const bulkActions = React.useMemo<BulkAction<MrpSuggestionRow>[]>(
    () => [
      {
        id: 'accept',
        label: t('production.mrp.action.bulk_accept', 'Accept selected'),
        onExecute: handleBulkAccept,
      },
      {
        id: 'dismiss',
        label: t('production.mrp.action.bulk_dismiss', 'Dismiss selected'),
        destructive: true,
        onExecute: handleBulkDismiss,
      },
    ],
    [handleBulkAccept, handleBulkDismiss],
  )

  if (runLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('production.mrp.loading', 'Loading MRP run...')} />
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('production.mrp.error.run_not_found', 'MRP run not found')}
            backHref="/backend/production/mrp"
            backLabel={t('production.mrp.title', 'MRP Runs')}
          />
        </PageBody>
      </Page>
    )
  }

  if (runError || !run) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={runError ?? t('production.mrp.error.run_not_found', 'MRP run not found')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex items-center gap-3">
          <MrpRunStatusBadge status={run.status} t={t} />
          <span className="text-sm text-muted-foreground">
            {t('production.mrp.run.detail_subtitle', 'Started {started} / Finished {finished}', {
              started: run.startedAt ? new Date(run.startedAt).toLocaleString() : '—',
              finished: run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '—',
            })}
          </span>
        </div>
        <DataTable<MrpSuggestionRow>
          title={t('production.mrp.suggestions.title', 'MRP Run Suggestions')}
          columns={columns}
          data={rows}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(values) => {
            setFilters(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilters({ status: 'open' })
            setPage(1)
          }}
          bulkActions={bulkActions}
          actions={
            <Button variant="outline" onClick={handleExportBuyCsv}>
              <Download className="mr-2 h-4 w-4" />
              {t('production.mrp.action.export_buy_csv', 'Export buy CSV')}
            </Button>
          }
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'accept',
                  label: t('production.mrp.action.accept', 'Accept'),
                  onSelect: () => handleSingleAccept(row),
                },
                {
                  id: 'dismiss',
                  label: t('production.mrp.action.dismiss', 'Dismiss'),
                  destructive: true,
                  onSelect: () => handleSingleDismiss(row),
                },
              ]}
            />
          )}
          emptyState={(
            <ListEmptyState
              entityName={t('production.mrp.suggestions.title', 'MRP Run Suggestions')}
              description={t('production.mrp.suggestions.empty_description', 'No open suggestions for this run.')}
            />
          )}
          refreshButton={{
            label: t('production.mrp.action.refresh', 'Refresh'),
            onRefresh: () => setReloadToken((prev) => prev + 1),
          }}
          pagination={{ page, pageSize: 20, total, totalPages: Math.max(1, Math.ceil(total / 20)), onPageChange: setPage }}
          isLoading={isLoading}
        />
        <Button variant="ghost" className="mt-4" onClick={() => router.push('/backend/production/mrp')}>
          {t('production.mrp.action.back_to_runs', 'Back to MRP Runs')}
        </Button>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
