'use client'

// Promotional-codes list page (Release 4 PLAN.md Step 6.6, SPEC-055 "Promotional Codes
// (`/backend/codes`)"): "Paginated `DataTable` (server-side) with filters: search, type,
// active. Dynamic code rows: progress bar `generated / amount`, Generate action button."
// Server-side pagination/filter shape copied from the `auth/backend/users/page.tsx` +
// `warranty_claims/backend/warranty_claims/registrations/page.tsx` precedent (own GET
// list route, `page`/`pageSize`/`search`/filter query params, `RowActions` in
// `rowActions`) rather than `promotions/backend/promotions/page.tsx`'s own hand-rolled
// drag-sortable card list, which has no `order` concept for `Code` to reuse.
//
// Generate action: `POST /api/promotions/codes/[id]/generate` (Step 6.4) only enqueues a
// queue job and deliberately builds no `ProgressJob` — that route's own comment explains
// `Code.generated`/`Code.amount` already ARE the progress signal, so a parallel
// `ProgressJob` would duplicate state for no benefit. This page mirrors that choice: no
// `ProgressTopBar` wiring (nothing to track — the route returns a bare queue `jobId`, not
// a `progressJobId`), just a flash on trigger plus a short burst of automatic reloads so
// the pool-size progress bar below catches a fast-finishing generation run without the
// admin needing to press the table's own manual Refresh button.

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Plus } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { promotionCodeTypeValues, promotionCodeUsageModeValues } from '../../data/validators'

const PAGE_SIZE = 50
const RESOURCE_KIND = 'promotions.code'
const GENERATE_POLL_INTERVALS_MS = [2000, 2000, 2000]

type CodeRow = {
  id: string
  name: string
  type: (typeof promotionCodeTypeValues)[number]
  code: string | null
  amount: number | null
  generated: number
  used: number
  usage: (typeof promotionCodeUsageModeValues)[number]
  active: boolean
  updatedAt: string | null
}

type ListResponse = {
  items: CodeRow[]
  total: number
  page: number
  totalPages: number
  totalIsCapped?: boolean
}

type GenerateResponse = { jobId: string }

function usageLabel(usage: CodeRow['usage'], t: ReturnType<typeof useT>): string {
  if (usage === 'single') return t('promotions.codes.list.usage.single', 'Single use')
  if (usage === 'multiple') return t('promotions.codes.list.usage.multiple', 'Multiple uses')
  return t('promotions.codes.list.usage.unlimited', 'Unlimited')
}

export default function CodesListPage() {
  const t = useT()
  const router = useRouter()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const canManage = chromeReady && hasFeature(chromePayload?.grantedFeatures, 'promotions.codes.manage')

  const [rows, setRows] = React.useState<CodeRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [generatingIds, setGeneratingIds] = React.useState<Set<string>>(new Set())

  const mutationContextId = 'promotions-codes-list:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const reload = React.useCallback(() => setReloadToken((v) => v + 1), [])

  const listQueryString = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    if (search) params.set('search', search)
    const type = typeof filterValues.type === 'string' ? filterValues.type : ''
    if (type) params.set('type', type)
    const active = typeof filterValues.active === 'string' ? filterValues.active : ''
    if (active === 'true' || active === 'false') params.set('active', active)
    return params.toString()
  }, [page, search, filterValues])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const fallback: ListResponse = { items: [], total: 0, page: 1, totalPages: 1 }
        const call = await apiCall<ListResponse>(`/api/promotions/codes?${listQueryString}`, undefined, { fallback })
        if (cancelled) return
        if (!call.ok) {
          setRows([])
          setLoadError(t('promotions.codes.list.errors.loadFailed', 'Failed to load promotional codes'))
          return
        }
        const payload = call.result ?? fallback
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items)
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' && payload.totalPages > 0 ? payload.totalPages : 1)
        setTotalIsCapped(payload.totalIsCapped === true)
      } catch {
        if (!cancelled) {
          setRows([])
          setLoadError(t('promotions.codes.list.errors.loadFailed', 'Failed to load promotional codes'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [listQueryString, reloadToken, t])

  const handleSearchChange = React.useCallback((next: string) => {
    setSearch(next)
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((next: FilterValues) => {
    setFilterValues(next)
    setPage(1)
  }, [])

  const handleGenerate = React.useCallback(
    async (row: CodeRow) => {
      setGeneratingIds((current) => new Set(current).add(row.id))
      try {
        await runMutation({
          operation: async () => {
            const call = await apiCall<GenerateResponse>(`/api/promotions/codes/${encodeURIComponent(row.id)}/generate`, {
              method: 'POST',
            })
            if (!call.ok) {
              throw Object.assign(new Error('[internal] promotions.codes.generate failed'), {
                status: call.status,
                ...((call.result as Record<string, unknown> | null) ?? {}),
              })
            }
            return call
          },
          context: {
            formId: mutationContextId,
            resourceKind: RESOURCE_KIND,
            resourceId: row.id,
            retryLastMutation,
          },
          mutationPayload: { action: 'generate' },
        })
        flash(t('promotions.codes.list.flash.generateStarted', 'Code generation started'), 'success')
        // §Backend Routes: the route enqueues a worker and intentionally has no
        // `ProgressJob` (`Code.generated`/`Code.amount` ARE the progress signal) — poll a
        // few times so the pool-size progress bar updates without a manual refresh.
        for (const delay of GENERATE_POLL_INTERVALS_MS) {
          await new Promise((resolve) => setTimeout(resolve, delay))
          reload()
        }
      } catch (error) {
        if (surfaceRecordConflict(error, t, { onRefresh: reload })) return
        const serverMessage = (error as { error?: unknown } | null)?.error
        flash(
          typeof serverMessage === 'string' && serverMessage.trim()
            ? serverMessage
            : t('promotions.codes.list.flash.generateError', 'Could not start code generation'),
          'error',
        )
      } finally {
        setGeneratingIds((current) => {
          const next = new Set(current)
          next.delete(row.id)
          return next
        })
      }
    },
    [mutationContextId, reload, retryLastMutation, runMutation, t],
  )

  const handleDelete = React.useCallback(
    async (row: CodeRow) => {
      const confirmed = await confirmDialog({
        title: t('promotions.codes.list.confirmDelete.title', 'Delete promotional code "{name}"?', { name: row.name }),
        description: t(
          'promotions.codes.list.confirmDelete.description',
          'This permanently removes the code and deactivates any codes already generated from it. This cannot be undone.',
        ),
        variant: 'destructive',
      })
      if (!confirmed) return
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
              deleteCrud('promotions/codes', row.id, {
                errorMessage: t('promotions.codes.list.flash.deleteError', 'Could not delete the promotional code'),
              }),
            ),
          context: {
            formId: mutationContextId,
            resourceKind: RESOURCE_KIND,
            resourceId: row.id,
            retryLastMutation,
          },
          mutationPayload: { id: row.id },
        })
        flash(t('promotions.codes.list.flash.deleted', 'Promotional code deleted'), 'success')
        reload()
      } catch (error) {
        if (surfaceRecordConflict(error, t, { onRefresh: reload })) return
        flash(
          error instanceof Error ? error.message : t('promotions.codes.list.flash.deleteError', 'Could not delete the promotional code'),
          'error',
        )
      }
    },
    [confirmDialog, mutationContextId, reload, retryLastMutation, runMutation, t],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'type',
        label: t('promotions.codes.list.filters.type', 'Type'),
        type: 'select',
        options: [
          { value: '', label: t('promotions.codes.list.filters.type.all', 'All') },
          { value: 'static', label: t('promotions.codes.list.filters.type.static', 'Static') },
          { value: 'dynamic', label: t('promotions.codes.list.filters.type.dynamic', 'Dynamic') },
        ],
      },
      {
        id: 'active',
        label: t('promotions.codes.list.filters.status', 'Status'),
        type: 'select',
        options: [
          { value: '', label: t('promotions.codes.list.filters.status.all', 'All') },
          { value: 'true', label: t('promotions.codes.list.filters.status.active', 'Active') },
          { value: 'false', label: t('promotions.codes.list.filters.status.inactive', 'Inactive') },
        ],
      },
    ],
    [t],
  )

  const columns = React.useMemo<ColumnDef<CodeRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('promotions.codes.list.columns.name', 'Name'),
        meta: { truncate: true, maxWidth: '220px' },
        cell: ({ row }) => (
          <Link href={`/backend/codes/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'type',
        header: t('promotions.codes.list.columns.type', 'Type'),
        meta: { maxWidth: '110px' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.type === 'static'
              ? t('promotions.codes.list.type.static', 'Static')
              : t('promotions.codes.list.type.dynamic', 'Dynamic')}
          </span>
        ),
      },
      {
        id: 'pool',
        header: t('promotions.codes.list.columns.pool', 'Code / pool'),
        meta: { maxWidth: '240px' },
        cell: ({ row }) => {
          const code = row.original
          if (code.type === 'static') {
            return <span className="font-mono text-sm">{code.code ?? '—'}</span>
          }
          const amount = code.amount ?? 0
          const percent = amount > 0 ? Math.min(100, Math.round((code.generated / amount) * 100)) : 0
          const isGenerating = generatingIds.has(code.id)
          const isFull = amount > 0 && code.generated >= amount
          return (
            <div className="flex items-center gap-3">
              <div className="min-w-28 space-y-1">
                <Progress value={percent} size="sm" aria-label={t('promotions.codes.list.columns.pool', 'Code / pool')} />
                <span className="block text-xs text-muted-foreground">
                  {t('promotions.codes.list.pool.fraction', '{generated} / {amount}', {
                    generated: String(code.generated),
                    amount: String(amount),
                  })}
                </span>
              </div>
              {canManage ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isGenerating || isFull}
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleGenerate(code)
                  }}
                >
                  {isGenerating ? <Spinner className="size-3.5" /> : null}
                  {isFull
                    ? t('promotions.codes.list.actions.generateFull', 'Pool full')
                    : t('promotions.codes.list.actions.generate', 'Generate')}
                </Button>
              ) : null}
            </div>
          )
        },
      },
      {
        accessorKey: 'usage',
        header: t('promotions.codes.list.columns.usage', 'Usage'),
        meta: { maxWidth: '130px' },
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{usageLabel(row.original.usage, t)}</span>,
      },
      {
        accessorKey: 'used',
        header: t('promotions.codes.list.columns.used', 'Used'),
        meta: { maxWidth: '80px' },
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.used}</span>,
      },
      {
        accessorKey: 'active',
        header: t('promotions.codes.list.columns.status', 'Status'),
        meta: { maxWidth: '110px' },
        cell: ({ row }) => (
          <StatusBadge variant={row.original.active ? 'success' : 'neutral'}>
            {row.original.active
              ? t('promotions.codes.list.status.active', 'Active')
              : t('promotions.codes.list.status.inactive', 'Inactive')}
          </StatusBadge>
        ),
      },
    ],
    [canManage, generatingIds, handleGenerate, t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable<CodeRow>
          title={t('promotions.codes.list.title', 'Promotional codes')}
          stickyActionsColumn
          columns={columns}
          data={rows}
          isLoading={isLoading}
          error={loadError}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('promotions.codes.list.searchPlaceholder', 'Search promotional codes...')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={() => handleFiltersApply({})}
          refreshButton={{
            label: t('promotions.codes.list.actions.refresh', 'Refresh'),
            onRefresh: reload,
            isRefreshing: isLoading,
          }}
          actions={
            canManage ? (
              <Button asChild>
                <Link href="/backend/codes/create">
                  <Plus className="mr-2 h-4 w-4" />
                  {t('promotions.codes.list.actions.create', 'Create code')}
                </Link>
              </Button>
            ) : undefined
          }
          onRowClick={(row) => router.push(`/backend/codes/${row.id}`)}
          rowActions={(row) =>
            canManage ? (
              <RowActions
                items={[
                  {
                    id: 'edit',
                    label: t('promotions.codes.list.actions.edit', 'Edit'),
                    onSelect: () => router.push(`/backend/codes/${row.id}`),
                  },
                  {
                    id: 'delete',
                    label: t('promotions.codes.list.actions.delete', 'Delete'),
                    destructive: true,
                    onSelect: () => {
                      void handleDelete(row)
                    },
                  },
                ]}
              />
            ) : null
          }
          emptyState={
            <ListEmptyState
              entityName={t('promotions.codes.list.title', 'Promotional codes')}
              title={t('promotions.codes.list.empty.title', 'No promotional codes yet')}
              description={t(
                'promotions.codes.list.empty.description',
                'Create a static or dynamic code to let buyers redeem a discount.',
              )}
              createHref={canManage ? '/backend/codes/create' : undefined}
              createLabel={t('promotions.codes.list.empty.createLabel', 'Create your first code')}
            />
          }
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            totalIsCapped,
            onPageChange: setPage,
          }}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
