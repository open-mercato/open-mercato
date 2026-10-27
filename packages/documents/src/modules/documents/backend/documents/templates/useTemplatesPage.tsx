"use client"

import * as React from 'react'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { normalizeTemplates, type TemplateRow } from '../components/templateUi'
import { readBoolean, readNumber, readRecord } from '../documentUi'

const TEMPLATE_MANAGEMENT_PAGE_SIZE = 100

function normalizePageSize(value: number): number {
  return Math.min(TEMPLATE_MANAGEMENT_PAGE_SIZE, Math.max(1, Math.floor(value)))
}

export function useTemplatesPage() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const requestId = React.useRef(0)
  const [rows, setRows] = React.useState<TemplateRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSizeState] = React.useState(TEMPLATE_MANAGEMENT_PAGE_SIZE)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [canManageTemplates, setCanManageTemplates] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const mutationContextId = 'documents-templates-list:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })
  const refresh = React.useCallback(() => setReloadToken((value) => value + 1), [])
  const refreshFromFirstPage = React.useCallback(() => {
    setPage(1)
    setReloadToken((value) => value + 1)
  }, [])
  const changeSearch = React.useCallback((value: string) => {
    setIsLoading(true)
    setLoadError(null)
    setSearch(value)
    setPage(1)
  }, [])
  const changePageSize = React.useCallback((value: number) => {
    setPageSizeState(normalizePageSize(value))
    setPage(1)
  }, [])

  React.useEffect(() => {
    const currentRequestId = ++requestId.current
    setIsLoading(true)
    setLoadError(null)
    setCanManageTemplates(false)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      includeBody: 'false',
    })
    if (search.trim()) params.set('search', search.trim())
    void apiCall<unknown>(`/api/documents/templates?${params.toString()}`, undefined, { fallback: { items: [] } })
      .then((call) => {
        if (requestId.current !== currentRequestId) return
        if (!call.ok) {
          setRows([])
          setTotal(0)
          setTotalPages(1)
          setTotalIsCapped(false)
          setCanManageTemplates(false)
          setLoadError(t('documents.templates.error.load'))
          return
        }
        const nextRows = normalizeTemplates(call.result)
        const root = readRecord(call.result)
        const nextPageSize = normalizePageSize(root ? readNumber(root, 'pageSize', 'page_size') ?? pageSize : pageSize)
        const nextTotal = Math.max(0, Math.floor(root ? readNumber(root, 'total', 'totalCount', 'total_count') ?? nextRows.length : nextRows.length))
        const nextTotalPages = Math.max(1, Math.floor(root ? readNumber(root, 'totalPages', 'total_pages') ?? Math.ceil(nextTotal / nextPageSize) : 1))
        const returnedPage = Math.max(1, Math.floor(root ? readNumber(root, 'page') ?? page : page))
        const nextTotalIsCapped = root ? readBoolean(root, 'totalIsCapped', 'total_is_capped') ?? false : false
        setRows(nextRows)
        setTotal(nextTotal)
        setTotalPages(nextTotalPages)
        setTotalIsCapped(nextTotalIsCapped)
        if (nextPageSize !== pageSize) setPageSizeState(nextPageSize)
        // A capped totalPages is a floor, so clamping to it would bounce the
        // user off pages that exist past the cap.
        if (!nextTotalIsCapped && Math.min(returnedPage, nextTotalPages) !== page) setPage(Math.min(returnedPage, nextTotalPages))
        const capabilities = readRecord(root?.capabilities)
        setCanManageTemplates(capabilities ? readBoolean(capabilities, 'canManageTemplates', 'can_manage_templates') ?? false : false)
      })
      .catch(() => {
        if (requestId.current !== currentRequestId) return
        setRows([])
        setTotal(0)
        setTotalPages(1)
        setTotalIsCapped(false)
        setCanManageTemplates(false)
        setLoadError(t('documents.templates.error.load'))
      })
      .finally(() => { if (requestId.current === currentRequestId) setIsLoading(false) })
  }, [page, pageSize, reloadToken, search, t])

  const deleteTemplate = React.useCallback(async (template: TemplateRow) => {
    if (!canManageTemplates) return
    if (!await confirm({ title: t('documents.templates.confirmDelete', { name: template.name }), variant: 'destructive' })) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(template.updatedAt),
          () => apiCallOrThrow(
            '/api/documents/templates',
            { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: template.id }) },
            { errorMessage: t('documents.templates.error.delete') },
          ),
        ),
        context: { formId: mutationContextId, resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate, resourceId: template.id, retryLastMutation },
        mutationPayload: { id: template.id },
      })
      flash(t('documents.templates.success.delete'), 'success')
      refreshFromFirstPage()
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: refreshFromFirstPage })) {
        flash(error instanceof Error ? error.message : t('documents.templates.error.delete'), 'error')
      }
    }
  }, [canManageTemplates, confirm, mutationContextId, refreshFromFirstPage, retryLastMutation, runMutation, t])

  return {
    rows,
    page,
    setPage,
    pageSize,
    setPageSize: changePageSize,
    total,
    totalPages,
    totalIsCapped,
    search,
    setSearch: changeSearch,
    isLoading,
    loadError,
    canManageTemplates,
    refresh,
    refreshFromFirstPage,
    deleteTemplate,
    ConfirmDialogElement,
  }
}
