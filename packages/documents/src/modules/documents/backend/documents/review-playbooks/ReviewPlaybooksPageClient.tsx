"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { formatDateTime } from '../documentUi'
import {
  normalizeReviewPlaybookList,
  REVIEW_PLAYBOOKS_API,
  REVIEW_PLAYBOOKS_PAGE_SIZE,
  type ReviewPlaybookRow,
} from './reviewPlaybookModel'

const RESOURCE_KIND = 'documents.review_playbook'
const MUTATION_CONTEXT_ID = 'documents-review-playbooks-list:mutation'

export function ReviewPlaybooksPageClient() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const requestId = React.useRef(0)
  const [rows, setRows] = React.useState<ReviewPlaybookRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(REVIEW_PLAYBOOKS_PAGE_SIZE)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: MUTATION_CONTEXT_ID, blockedMessage: t('ui.forms.flash.saveBlocked') })
  const refresh = React.useCallback(() => setReloadToken((value) => value + 1), [])

  React.useEffect(() => {
    const currentRequest = ++requestId.current
    setIsLoading(true)
    setLoadError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search.trim()) params.set('search', search.trim())
    void apiCall<unknown>(`${REVIEW_PLAYBOOKS_API}?${params.toString()}`, undefined, { fallback: { items: [] } })
      .then((call) => {
        if (requestId.current !== currentRequest) return
        if (!call.ok) {
          setRows([])
          setLoadError(t('documents.reviewPlaybooks.list.error'))
          return
        }
        const list = normalizeReviewPlaybookList(call.result)
        setRows(list.rows)
        setTotal(list.total)
        setTotalPages(list.totalPages)
        setTotalIsCapped(list.totalIsCapped)
      })
      .catch(() => {
        if (requestId.current === currentRequest) setLoadError(t('documents.reviewPlaybooks.list.error'))
      })
      .finally(() => {
        if (requestId.current === currentRequest) setIsLoading(false)
      })
  }, [page, pageSize, reloadToken, search, t])

  const openPlaybook = React.useCallback((row: ReviewPlaybookRow) => {
    router.push(`/backend/documents/review-playbooks/${encodeURIComponent(row.id)}`)
  }, [router])

  const deletePlaybook = React.useCallback(async (row: ReviewPlaybookRow) => {
    const confirmed = await confirm({
      title: t('documents.reviewPlaybooks.delete.title', { name: row.name }),
      description: t('documents.reviewPlaybooks.delete.description'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
          deleteCrud('documents/review-playbooks', row.id, { errorMessage: t('documents.reviewPlaybooks.delete.error') }),
        ),
        context: { formId: MUTATION_CONTEXT_ID, resourceKind: RESOURCE_KIND, resourceId: row.id, retryLastMutation },
        mutationPayload: { id: row.id },
      })
      flash(t('documents.reviewPlaybooks.delete.success'), 'success')
      refresh()
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: refresh })) return
      flash(error instanceof Error ? error.message : t('documents.reviewPlaybooks.delete.error'), 'error')
    }
  }, [confirm, refresh, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<ReviewPlaybookRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('documents.reviewPlaybooks.columns.name'),
      meta: { alwaysVisible: true, maxWidth: '260px', truncate: true },
      cell: ({ row }) => (
        <Link href={`/backend/documents/review-playbooks/${encodeURIComponent(row.original.id)}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'code',
      header: t('documents.reviewPlaybooks.columns.code'),
      meta: { maxWidth: '160px', truncate: true },
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
    },
    {
      accessorKey: 'version',
      header: t('documents.reviewPlaybooks.columns.version'),
      cell: ({ row }) => t('documents.reviewPlaybooks.versionLabel', { version: row.original.version }),
    },
    {
      accessorKey: 'isActive',
      header: t('documents.reviewPlaybooks.columns.status'),
      cell: ({ row }) => (
        <StatusBadge variant={row.original.isActive ? 'success' : 'neutral'} dot>
          {t(row.original.isActive ? 'documents.reviewPlaybooks.status.active' : 'documents.reviewPlaybooks.status.inactive')}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: t('documents.columns.updatedAt'),
      meta: { maxWidth: '180px' },
      cell: ({ row }) => formatDateTime(row.original.updatedAt, t('documents.list.noValue')),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        {loadError ? (
          <ErrorMessage
            label={loadError}
            action={<Button type="button" size="sm" variant="outline" onClick={refresh}>{t('documents.actions.retry')}</Button>}
          />
        ) : (
          <DataTable<ReviewPlaybookRow>
            title={t('documents.reviewPlaybooks.list.title')}
            titleHeadingLevel={1}
            actions={(
              <Button asChild>
                <Link href="/backend/documents/review-playbooks/create">{t('documents.reviewPlaybooks.actions.new')}</Link>
              </Button>
            )}
            refreshButton={{ label: t('documents.actions.refresh'), onRefresh: refresh, isRefreshing: isLoading }}
            columns={columns}
            data={rows}
            isLoading={isLoading}
            searchValue={search}
            onSearchChange={(value) => { setSearch(value); setPage(1) }}
            searchPlaceholder={t('documents.reviewPlaybooks.list.searchPlaceholder')}
            emptyState={t('documents.reviewPlaybooks.list.empty')}
            entityId={DOCUMENTS_ENTITY_IDS.documentReviewPlaybook}
            extensionTableId="documents.review_playbooks.list"
            onRowClick={openPlaybook}
            rowClickActionIds={['edit']}
            stickyActionsColumn
            pagination={{
              page,
              pageSize,
              total,
              totalPages,
              totalIsCapped,
              onPageChange: setPage,
              onPageSizeChange: (value) => { setPageSize(Math.min(100, Math.max(1, value))); setPage(1) },
              pageSizeOptions: [25, 50, 100],
            }}
            rowActions={(row) => (
              <RowActions items={[
                { id: 'edit', label: t('documents.actions.edit'), onSelect: () => openPlaybook(row) },
                { id: 'delete', label: t('documents.actions.delete'), destructive: true, onSelect: () => void deletePlaybook(row) },
              ]} />
            )}
          />
        )}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

export default ReviewPlaybooksPageClient
