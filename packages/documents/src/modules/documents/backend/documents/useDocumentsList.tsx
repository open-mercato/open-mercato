"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  hasActiveTemplate,
  canWriteToFolder,
  EMPTY_COLLECTION_CAPABILITIES,
  normalizeCollectionCapabilities,
  normalizeDocuments,
  normalizeFolders,
  readCreatedId,
  type DocumentRow,
  type FolderRow,
  type CollectionCapabilities,
} from './documentsListTypes'
import { readNumber, readRecord } from './documentUi'

export function useDocumentsList() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const requestId = React.useRef(0)
  const [rows, setRows] = React.useState<DocumentRow[]>([])
  const [folders, setFolders] = React.useState<FolderRow[]>([])
  const [selectedFolderId, setSelectedFolderId] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [hasTemplates, setHasTemplates] = React.useState(false)
  const [collectionCapabilities, setCollectionCapabilities] = React.useState<CollectionCapabilities>(EMPTY_COLLECTION_CAPABILITIES)
  const [reloadToken, setReloadToken] = React.useState(0)
  const mutationContextId = 'documents-list:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const refresh = React.useCallback(() => setReloadToken((token) => token + 1), [])
  React.useEffect(() => {
    const currentRequestId = ++requestId.current
    setIsLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search.trim()) params.set('search', search.trim())
    if (selectedFolderId) params.set('folderId', selectedFolderId)
    void Promise.all([
      apiCall<unknown>('/api/documents/folders', undefined, { fallback: { items: [] } }),
      apiCall<unknown>(`/api/documents?${params.toString()}`, undefined, { fallback: { items: [] } }),
    ]).then(([foldersCall, documentsCall]) => {
      if (requestId.current !== currentRequestId) return
      if (!foldersCall.ok || !documentsCall.ok) {
        setRows([])
        setFolders([])
        setTotal(0)
        setTotalPages(1)
        setCollectionCapabilities(EMPTY_COLLECTION_CAPABILITIES)
        flash(t('documents.list.error.load'), 'error')
        return
      }
      const nextFolders = normalizeFolders(foldersCall.result)
      const nextRows = normalizeDocuments(documentsCall.result, nextFolders, t('documents.list.unknownOwner'))
      const root = readRecord(documentsCall.result)
      const nextTotal = root ? readNumber(root, 'total', 'totalCount', 'total_count') ?? nextRows.length : nextRows.length
      setFolders(nextFolders)
      setRows(nextRows)
      setCollectionCapabilities(normalizeCollectionCapabilities(documentsCall.result))
      setTotal(nextTotal)
      setTotalPages(root ? readNumber(root, 'totalPages', 'total_pages') ?? Math.max(1, Math.ceil(nextTotal / pageSize)) : 1)
    }).catch(() => {
      if (requestId.current !== currentRequestId) return
      setRows([])
      setFolders([])
      setTotal(0)
      setTotalPages(1)
      setCollectionCapabilities(EMPTY_COLLECTION_CAPABILITIES)
      flash(t('documents.list.error.load'), 'error')
    }).finally(() => {
      if (requestId.current === currentRequestId) setIsLoading(false)
    })
  }, [page, pageSize, reloadToken, search, selectedFolderId, t])

  React.useEffect(() => {
    let active = true
    void apiCall<unknown>('/api/documents/templates?page=1&pageSize=1&isActive=true', undefined, { fallback: { items: [] } })
      .then((call) => { if (active) setHasTemplates(call.ok && hasActiveTemplate(call.result)) })
    return () => { active = false }
  }, [])

  const createDocument = React.useCallback(async () => {
    const selectedFolder = selectedFolderId ? folders.find((folder) => folder.id === selectedFolderId) ?? null : null
    if (!collectionCapabilities.canCreateDocument || !canWriteToFolder(selectedFolderId, selectedFolder)) return
    try {
      const call = await runMutation({
        operation: () => apiCallOrThrow<unknown>(
          '/api/documents',
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: t('documents.documents.untitled'), folderId: selectedFolderId }) },
          { errorMessage: t('documents.list.error.create') },
        ),
        context: { formId: mutationContextId, resourceKind: 'documents.document', resourceId: selectedFolderId ?? 'new', retryLastMutation },
        mutationPayload: { folderId: selectedFolderId },
      })
      const id = readCreatedId(call.result)
      if (!id) throw new Error(t('documents.list.error.missingCreatedId'))
      router.push(`/backend/documents/${id}`)
    } catch (error) { flash(error instanceof Error ? error.message : t('documents.list.error.create'), 'error') }
  }, [collectionCapabilities.canCreateDocument, folders, mutationContextId, retryLastMutation, router, runMutation, selectedFolderId, t])

  const deleteDocument = React.useCallback(async (row: DocumentRow) => {
    if (!await confirm({ title: t('documents.list.confirmDelete', { title: row.title }), variant: 'destructive' })) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () => apiCallOrThrow(`/api/documents/${encodeURIComponent(row.id)}`, { method: 'DELETE' })),
        context: { formId: mutationContextId, resourceKind: 'documents.document', resourceId: row.id, retryLastMutation },
        mutationPayload: { id: row.id },
      })
      flash(t('documents.list.success.delete'), 'success')
      refresh()
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: refresh })) {
        flash(error instanceof Error ? error.message : t('documents.list.error.delete'), 'error')
      }
    }
  }, [confirm, mutationContextId, refresh, retryLastMutation, runMutation, t])

  const moveDocument = React.useCallback(async (row: DocumentRow, folderId: string | null) => {
    if (!row.capabilities.canEdit || row.folderId === folderId) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt),
          () => apiCallOrThrow(
            `/api/documents/${encodeURIComponent(row.id)}`,
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ folderId }),
            },
            { errorMessage: t('documents.folders.error.moveDocument') },
          ),
        ),
        context: { formId: mutationContextId, resourceKind: 'documents.document', resourceId: row.id, retryLastMutation },
        mutationPayload: { id: row.id, folderId },
      })
      flash(t('documents.folders.success.moveDocument'), 'success')
      refresh()
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: refresh })) {
        flash(error instanceof Error ? error.message : t('documents.folders.error.moveDocument'), 'error')
      }
    }
  }, [mutationContextId, refresh, retryLastMutation, runMutation, t])

  const saveFolder = React.useCallback(async (input: { folder?: FolderRow; parentFolderId?: string | null; name: string }) => {
    const isRename = Boolean(input.folder)
    const folder = input.folder
    const operation = () => apiCallOrThrow(
      '/api/documents/folders',
      {
        method: isRename ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(isRename ? { id: folder?.id, name: input.name, parentFolderId: folder?.parentFolderId } : { name: input.name, parentFolderId: input.parentFolderId ?? null }),
      },
      { errorMessage: t(isRename ? 'documents.folders.error.rename' : 'documents.folders.error.create') },
    )
    try {
      await runMutation({
        operation: () => isRename ? withScopedApiRequestHeaders(buildOptimisticLockHeader(folder?.updatedAt), operation) : operation(),
        context: { formId: mutationContextId, resourceKind: 'documents.document_folder', resourceId: folder?.id ?? input.parentFolderId ?? 'new', retryLastMutation },
        mutationPayload: input,
      })
      flash(t(isRename ? 'documents.folders.success.rename' : 'documents.folders.success.create'), 'success')
      refresh()
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: refresh })) {
        flash(error instanceof Error ? error.message : t(isRename ? 'documents.folders.error.rename' : 'documents.folders.error.create'), 'error')
      }
    }
  }, [mutationContextId, refresh, retryLastMutation, runMutation, t])

  const deleteFolder = React.useCallback(async (folder: FolderRow) => {
    if (!await confirm({ title: t('documents.folders.confirmDelete', { name: folder.name }), variant: 'destructive' })) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(folder.updatedAt), () => apiCallOrThrow('/api/documents/folders', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: folder.id }) })),
        context: { formId: mutationContextId, resourceKind: 'documents.document_folder', resourceId: folder.id, retryLastMutation },
        mutationPayload: { id: folder.id },
      })
      if (selectedFolderId === folder.id) setSelectedFolderId(null)
      flash(t('documents.folders.success.delete'), 'success')
      refresh()
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: refresh })) {
        flash(error instanceof Error ? error.message : t('documents.folders.error.delete'), 'error')
      }
    }
  }, [confirm, mutationContextId, refresh, retryLastMutation, runMutation, selectedFolderId, t])

  return {
    rows, folders, selectedFolderId, setSelectedFolderId, page, setPage, pageSize, setPageSize,
    total, totalPages, search, setSearch, isLoading, hasTemplates, collectionCapabilities, refresh,
    createDocument, deleteDocument, moveDocument, saveFolder, deleteFolder, ConfirmDialogElement,
  }
}
