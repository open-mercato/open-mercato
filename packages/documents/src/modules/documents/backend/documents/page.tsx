"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable, RowActions } from '@open-mercato/ui'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import { ShareDialog } from './components/ShareDialog'
import { NewFromTemplateDialog } from './components/NewFromTemplateDialog'

type DocumentRow = {
  id: string
  title: string
  folderId?: string | null
  folderName?: string | null
  ownerLabel: string
  sharedWithCount: number
  updatedAt?: string | null
}

type FolderRow = {
  id: string
  name: string
  parentFolderId?: string | null
  updatedAt?: string | null
}

type FolderNode = FolderRow & {
  children: FolderNode[]
}

type ListResponse = {
  items?: unknown[]
  data?: unknown[]
  documents?: unknown[]
  total?: number
  totalCount?: number
  total_count?: number
  totalPages?: number
  total_pages?: number
  page?: number
}

type FoldersResponse = {
  items?: unknown[]
  data?: unknown[]
  folders?: unknown[]
}

type TemplatesResponse = {
  items?: unknown[]
  data?: unknown[]
  templates?: unknown[]
}

type FolderDialogState =
  | { mode: 'create'; parentFolderId?: string | null }
  | { mode: 'rename'; folder: FolderRow }

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function readBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  return null
}

function readArrayPayload(payload: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload
  const record = readRecord(payload)
  if (!record) return []
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function normalizeFolder(value: unknown): FolderRow | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const name = readString(record, 'name')
  if (!id || !name) return null
  return {
    id,
    name,
    parentFolderId: readString(record, 'parentFolderId', 'parent_folder_id'),
    updatedAt: readString(record, 'updatedAt', 'updated_at'),
  }
}

function normalizeDocument(value: unknown, folderMap: Map<string, FolderRow>, unknownOwner: string): DocumentRow | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const title = readString(record, 'title')
  if (!id || !title) return null
  const folderId = readString(record, 'folderId', 'folder_id')
  const folderName = readString(record, 'folderName', 'folder_name') ?? (folderId ? folderMap.get(folderId)?.name ?? null : null)
  const ownerLabel =
    readString(record, 'ownerName', 'owner_name', 'ownerEmail', 'owner_email', 'createdByName', 'created_by_name') ??
    readString(record, 'ownerUserId', 'owner_user_id') ??
    unknownOwner
  return {
    id,
    title,
    folderId,
    folderName,
    ownerLabel,
    sharedWithCount: readNumber(record, 'sharedWithCount', 'shared_with_count', 'shareCount', 'share_count') ?? 0,
    updatedAt: readString(record, 'updatedAt', 'updated_at'),
  }
}

function normalizeFolders(payload: FoldersResponse | unknown[] | null): FolderRow[] {
  return readArrayPayload(payload, 'items', 'data', 'folders')
    .map(normalizeFolder)
    .filter((folder): folder is FolderRow => folder !== null)
}

function hasActiveTemplate(payload: TemplatesResponse | unknown[] | null): boolean {
  return readArrayPayload(payload, 'items', 'data', 'templates').some((item) => {
    const record = readRecord(item)
    if (!record) return false
    return readBoolean(record, 'isActive', 'is_active') !== false
  })
}

function readCreatedId(payload: unknown): string | null {
  const root = readRecord(payload)
  if (!root) return null
  const nestedDocument = readRecord(root.document)
  const nestedItem = readRecord(root.item)
  const nestedData = readRecord(root.data)
  return (
    readString(root, 'id') ??
    (nestedDocument ? readString(nestedDocument, 'id') : null) ??
    (nestedItem ? readString(nestedItem, 'id') : null) ??
    (nestedData ? readString(nestedData, 'id') : null)
  )
}

function buildFolderTree(folders: FolderRow[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>()
  for (const folder of folders) nodes.set(folder.id, { ...folder, children: [] })
  const roots: FolderNode[] = []
  for (const node of nodes.values()) {
    const parentId = node.parentFolderId
    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortNodes = (items: FolderNode[]) => {
    items.sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }))
    for (const item of items) sortNodes(item.children)
  }
  sortNodes(roots)
  return roots
}

function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString()
}

export default function DocumentsPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<DocumentRow[]>([])
  const [folders, setFolders] = React.useState<FolderRow[]>([])
  const [selectedFolderId, setSelectedFolderId] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [shareDocument, setShareDocument] = React.useState<DocumentRow | null>(null)
  const [newFromTemplateOpen, setNewFromTemplateOpen] = React.useState(false)
  const [hasTemplates, setHasTemplates] = React.useState(false)
  const [folderDialog, setFolderDialog] = React.useState<FolderDialogState | null>(null)
  const [folderName, setFolderName] = React.useState('')
  const folderNameInputId = React.useId()

  const mutationContextId = 'documents-list:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const folderMap = React.useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const folderTree = React.useMemo(() => buildFolderTree(folders), [folders])
  const selectedFolder = selectedFolderId ? folderMap.get(selectedFolderId) ?? null : null

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      if (search.trim()) params.set('search', search.trim())
      if (selectedFolderId) params.set('folderId', selectedFolderId)

      const [foldersCall, documentsCall] = await Promise.all([
        apiCall<FoldersResponse>('/api/documents/folders', undefined, { fallback: { items: [] } }),
        apiCall<ListResponse>(`/api/documents?${params.toString()}`, undefined, { fallback: { items: [], total: 0, totalPages: 1 } }),
      ])
      const nextFolders = foldersCall.ok ? normalizeFolders(foldersCall.result) : []
      const nextFolderMap = new Map(nextFolders.map((folder) => [folder.id, folder]))
      setFolders(nextFolders)

      if (!foldersCall.ok || !documentsCall.ok) {
        flash(t('documents.list.error.load'), 'error')
        setRows([])
        setTotal(0)
        setTotalPages(1)
        return
      }

      const payload = documentsCall.result ?? { items: [], total: 0, totalPages: 1 }
      const items = readArrayPayload(payload, 'items', 'data', 'documents')
      const nextRows = items
        .map((item) => normalizeDocument(item, nextFolderMap, t('documents.list.unknownOwner')))
        .filter((row): row is DocumentRow => row !== null)
      setRows(nextRows)
      setTotal(payload.total ?? payload.totalCount ?? payload.total_count ?? nextRows.length)
      setTotalPages(payload.totalPages ?? payload.total_pages ?? Math.max(1, Math.ceil(nextRows.length / pageSize)))
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.list.error.load'), 'error')
      setRows([])
      setTotal(0)
      setTotalPages(1)
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, search, selectedFolderId, t])

  React.useEffect(() => {
    void loadData()
  }, [loadData, reloadToken])

  React.useEffect(() => {
    let cancelled = false
    apiCall<TemplatesResponse>('/api/documents/templates', undefined, { fallback: { items: [] } })
      .then((call) => {
        if (cancelled) return
        setHasTemplates(call.ok && hasActiveTemplate(call.result ?? { items: [] }))
      })
      .catch(() => {
        if (!cancelled) setHasTemplates(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (folderDialog?.mode === 'rename') {
      setFolderName(folderDialog.folder.name)
    } else if (folderDialog?.mode === 'create') {
      setFolderName('')
    }
  }, [folderDialog])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleCreateDocument = React.useCallback(async () => {
    try {
      const call = await runMutation({
        operation: async () =>
          apiCallOrThrow<unknown>(
            '/api/documents',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                title: t('documents.documents.untitled'),
                folderId: selectedFolderId,
              }),
            },
            { errorMessage: t('documents.list.error.create') },
          ),
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document',
          resourceId: selectedFolderId ?? 'new',
          retryLastMutation,
        },
        mutationPayload: { folderId: selectedFolderId },
      })
      const id = readCreatedId(call.result)
      if (!id) throw new Error(t('documents.list.error.missingCreatedId'))
      router.push(`/backend/documents/${id}`)
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.list.error.create'), 'error')
    }
  }, [mutationContextId, retryLastMutation, router, runMutation, selectedFolderId, t])

  const handleDeleteDocument = React.useCallback(async (row: DocumentRow) => {
    const confirmed = await confirm({
      title: t('documents.list.confirmDelete', undefined, { title: row.title }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: async () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt),
            () => apiCallOrThrow(
              `/api/documents/${encodeURIComponent(row.id)}`,
              { method: 'DELETE' },
              { errorMessage: t('documents.list.error.delete') },
            ),
          ),
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document',
          resourceId: row.id,
          retryLastMutation,
        },
        mutationPayload: { id: row.id },
      })
      flash(t('documents.list.success.delete'), 'success')
      handleRefresh()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.list.error.delete'), 'error')
    }
  }, [confirm, handleRefresh, mutationContextId, retryLastMutation, runMutation, t])

  const handleSubmitFolder = React.useCallback(async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!folderDialog) return
    const trimmedName = folderName.trim()
    if (!trimmedName) return
    try {
      if (folderDialog.mode === 'create') {
        await runMutation({
          operation: async () =>
            apiCallOrThrow(
              '/api/documents/folders',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  name: trimmedName,
                  parentFolderId: folderDialog.parentFolderId ?? null,
                }),
              },
              { errorMessage: t('documents.folders.error.create') },
            ),
          context: {
            formId: mutationContextId,
            resourceKind: 'documents.document_folder',
            resourceId: folderDialog.parentFolderId ?? 'new',
            retryLastMutation,
          },
          mutationPayload: { name: trimmedName, parentFolderId: folderDialog.parentFolderId ?? null },
        })
        flash(t('documents.folders.success.create'), 'success')
      } else {
        await runMutation({
          operation: async () =>
            withScopedApiRequestHeaders(
              buildOptimisticLockHeader(folderDialog.folder.updatedAt),
              () => apiCallOrThrow(
                '/api/documents/folders',
                {
                  method: 'PUT',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    id: folderDialog.folder.id,
                    name: trimmedName,
                    parentFolderId: folderDialog.folder.parentFolderId ?? null,
                  }),
                },
                { errorMessage: t('documents.folders.error.rename') },
              ),
            ),
          context: {
            formId: mutationContextId,
            resourceKind: 'documents.document_folder',
            resourceId: folderDialog.folder.id,
            retryLastMutation,
          },
          mutationPayload: { id: folderDialog.folder.id, name: trimmedName },
        })
        flash(t('documents.folders.success.rename'), 'success')
      }
      setFolderDialog(null)
      handleRefresh()
    } catch (err) {
      const fallback = folderDialog.mode === 'create'
        ? t('documents.folders.error.create')
        : t('documents.folders.error.rename')
      flash(err instanceof Error ? err.message : fallback, 'error')
    }
  }, [folderDialog, folderName, handleRefresh, mutationContextId, retryLastMutation, runMutation, t])

  const handleDeleteFolder = React.useCallback(async (folder: FolderRow) => {
    const confirmed = await confirm({
      title: t('documents.folders.confirmDelete', undefined, { name: folder.name }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: async () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(folder.updatedAt),
            () => apiCallOrThrow(
              '/api/documents/folders',
              {
                method: 'DELETE',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: folder.id }),
              },
              { errorMessage: t('documents.folders.error.delete') },
            ),
          ),
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_folder',
          resourceId: folder.id,
          retryLastMutation,
        },
        mutationPayload: { id: folder.id },
      })
      if (selectedFolderId === folder.id) setSelectedFolderId(null)
      flash(t('documents.folders.success.delete'), 'success')
      handleRefresh()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.folders.error.delete'), 'error')
    }
  }, [confirm, handleRefresh, mutationContextId, retryLastMutation, runMutation, selectedFolderId, t])

  const renderFolderNodes = React.useCallback((nodes: FolderNode[]): React.ReactNode => (
    <div className="space-y-1">
      {nodes.map((node) => (
        <div key={node.id} className="space-y-1">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={selectedFolderId === node.id ? 'secondary' : 'ghost'}
              className="min-w-0 flex-1 justify-start"
              onClick={() => {
                setSelectedFolderId(node.id)
                setPage(1)
              }}
            >
              <span className="truncate">{node.name}</span>
            </Button>
            <RowActions
              items={[
                {
                  id: 'rename',
                  label: t('documents.folders.actions.rename'),
                  onSelect: () => setFolderDialog({ mode: 'rename', folder: node }),
                },
                {
                  id: 'delete',
                  label: t('documents.actions.delete'),
                  destructive: true,
                  onSelect: () => void handleDeleteFolder(node),
                },
              ]}
            />
          </div>
          {node.children.length > 0 ? (
            <div className="ml-4">
              {renderFolderNodes(node.children)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  ), [handleDeleteFolder, selectedFolderId, t])

  const columns = React.useMemo<ColumnDef<DocumentRow>[]>(() => [
    {
      accessorKey: 'title',
      header: t('documents.columns.title'),
      meta: { alwaysVisible: true, maxWidth: '260px' },
      cell: ({ row }) => (
        <Link href={`/backend/documents/${row.original.id}`} className="font-medium hover:underline">
          {row.original.title}
        </Link>
      ),
    },
    {
      accessorKey: 'folderName',
      header: t('documents.columns.folder'),
      meta: { maxWidth: '180px' },
      cell: ({ row }) => row.original.folderName ?? <span className="text-sm text-muted-foreground">{t('documents.folders.none')}</span>,
    },
    {
      accessorKey: 'ownerLabel',
      header: t('documents.columns.owner'),
      meta: { maxWidth: '220px' },
      cell: ({ row }) => <span className="text-sm">{row.original.ownerLabel}</span>,
    },
    {
      accessorKey: 'sharedWithCount',
      header: t('documents.columns.sharedWith'),
      cell: ({ row }) => <span className="text-sm">{row.original.sharedWithCount}</span>,
    },
    {
      accessorKey: 'updatedAt',
      header: t('documents.columns.updatedAt'),
      meta: { maxWidth: '180px' },
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.updatedAt, t('documents.list.noValue'))}</span>,
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-4">
          <aside className="space-y-3 rounded-lg border border-border bg-card p-4 lg:col-span-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('documents.folders.title')}</h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setFolderDialog({ mode: 'create', parentFolderId: selectedFolderId })}
              >
                {t('documents.folders.actions.new')}
              </Button>
            </div>
            <div className="space-y-1">
              <Button
                type="button"
                variant={selectedFolderId === null ? 'secondary' : 'ghost'}
                className="w-full justify-start"
                onClick={() => {
                  setSelectedFolderId(null)
                  setPage(1)
                }}
              >
                {t('documents.folders.root')}
              </Button>
              {folderTree.length > 0 ? renderFolderNodes(folderTree) : (
                <p className="rounded border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                  {t('documents.folders.empty')}
                </p>
              )}
            </div>
          </aside>

          <div className="min-w-0 lg:col-span-3">
            <DataTable<DocumentRow>
              title={selectedFolder ? selectedFolder.name : t('documents.list.title')}
              actions={(
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild variant="outline">
                    <Link href="/backend/documents/templates">
                      {t('documents.templates.actions.manage', 'Templates')}
                    </Link>
                  </Button>
                  {hasTemplates ? (
                    <Button type="button" variant="outline" onClick={() => setNewFromTemplateOpen(true)}>
                      {t('documents.templates.instantiate.title', 'New from template')}
                    </Button>
                  ) : null}
                  <Button type="button" onClick={() => void handleCreateDocument()}>
                    {t('documents.actions.create')}
                  </Button>
                </div>
              )}
              refreshButton={{
                label: t('documents.actions.refresh'),
                onRefresh: handleRefresh,
                isRefreshing: isLoading,
              }}
              columns={columns}
              data={rows}
              isLoading={isLoading}
              searchValue={search}
              onSearchChange={(value) => {
                setSearch(value)
                setPage(1)
              }}
              searchPlaceholder={t('documents.list.searchPlaceholder')}
              emptyState={t('documents.list.empty')}
              entityId={DOCUMENTS_ENTITY_IDS.document}
              extensionTableId="documents.documents.list"
              onRowClick={(row) => router.push(`/backend/documents/${row.id}`)}
              rowClickActionIds={['open']}
              stickyActionsColumn
              pagination={{
                page,
                pageSize,
                total,
                totalPages,
                onPageChange: setPage,
                onPageSizeChange: (nextPageSize) => {
                  setPageSize(nextPageSize)
                  setPage(1)
                },
              }}
              rowActions={(row) => (
                <RowActions
                  items={[
                    {
                      id: 'open',
                      label: t('documents.actions.open'),
                      onSelect: () => router.push(`/backend/documents/${row.id}`),
                    },
                    {
                      id: 'share',
                      label: t('documents.actions.share'),
                      onSelect: () => setShareDocument(row),
                    },
                    {
                      id: 'delete',
                      label: t('documents.actions.delete'),
                      destructive: true,
                      onSelect: () => void handleDeleteDocument(row),
                    },
                  ]}
                />
              )}
            />
          </div>
        </div>

        <Dialog open={folderDialog !== null} onOpenChange={(open) => { if (!open) setFolderDialog(null) }}>
          <DialogContent
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void handleSubmitFolder()
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {folderDialog?.mode === 'rename'
                  ? t('documents.folders.renameTitle')
                  : t('documents.folders.createTitle')}
              </DialogTitle>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleSubmitFolder}>
              <div className="space-y-2">
                <Label htmlFor={folderNameInputId}>{t('documents.folders.name')}</Label>
                <Input
                  id={folderNameInputId}
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  placeholder={t('documents.folders.namePlaceholder')}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setFolderDialog(null)}>
                  {t('documents.actions.cancel')}
                </Button>
                <Button type="submit" disabled={folderName.trim().length === 0}>
                  {folderDialog?.mode === 'rename'
                    ? t('documents.folders.actions.rename')
                    : t('documents.folders.actions.create')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {shareDocument ? (
          <ShareDialog
            documentId={shareDocument.id}
            open={shareDocument !== null}
            onOpenChange={(open) => { if (!open) setShareDocument(null) }}
          />
        ) : null}
        <NewFromTemplateDialog
          open={newFromTemplateOpen}
          folderId={selectedFolderId}
          onOpenChange={setNewFromTemplateOpen}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
