"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, Bell, Copy, History, Star, Trash2 } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ShareDialog } from '../components/ShareDialog'
import { normalizeDocumentContent, normalizeDocumentDetail, type DocumentContent, type DocumentDetail } from '../documentUi'
import { CommentsRail } from './CommentsRail'
import type { CommentAnchor } from './CommentAnchorNavigation'
import { ExportMenu } from './ExportMenu'
import { RelatedRecordsPanel } from './RelatedRecordsPanel'
import { DocumentNavigator } from './DocumentNavigator'
import { DocumentEditorErrorBoundary } from './DocumentEditorErrorBoundary'
import { VersionHistoryPanel } from './VersionHistoryPanel'

function DocumentEditorLoading({ error, retry }: { error?: Error | null; retry?: () => void }) {
  const t = useT()
  if (error) {
    return (
      <ErrorMessage
        label={t('documents.editor.error.load')}
        action={<Button type="button" variant="outline" onClick={retry}>{t('documents.actions.retry')}</Button>}
      />
    )
  }
  return <div role="status" aria-live="polite"><LoadingMessage label={t('documents.editor.loading')} /></div>
}

const DocumentEditorIsland = dynamic(() => import('./DocumentEditorIsland'), { ssr: false, loading: DocumentEditorLoading })

type CommentFocusRequest = { anchor: CommentAnchor; requestId: number }
type LoadState =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'error'; message: string }
  | { status: 'ready'; document: DocumentDetail; content: DocumentContent }

export function DocumentPageClient({ documentId }: { documentId: string }) {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })
  const [shareOpen, setShareOpen] = React.useState(false)
  const [showVersions, setShowVersions] = React.useState(false)
  const [editorEpoch, setEditorEpoch] = React.useState(0)
  const [editor, setEditor] = React.useState<Editor | null>(null)
  const [commentFocusRequest, setCommentFocusRequest] = React.useState<CommentFocusRequest | null>(null)
  const requestSequence = React.useRef(0)
  const mutationContextId = `documents-detail:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const loadDocument = React.useCallback(async () => {
    const requestId = ++requestSequence.current
    setState({ status: 'loading' })
    try {
      const [documentCall, contentCall] = await Promise.all([
        apiCall<unknown>(`/api/documents/${encodeURIComponent(documentId)}`),
        apiCall<unknown>(`/api/documents/${encodeURIComponent(documentId)}/content`),
      ])
      if (requestSequence.current !== requestId) return
      if (documentCall.status === 404) return setState({ status: 'notFound' })
      if (!documentCall.ok) return setState({ status: 'error', message: t('documents.editor.error.load') })
      if (!contentCall.ok && contentCall.status !== 404) {
        return setState({ status: 'error', message: t('documents.editor.error.loadContent') })
      }
      const document = normalizeDocumentDetail(documentCall.result)
      if (!document) return setState({ status: 'error', message: t('documents.editor.error.load') })
      setState({
        status: 'ready',
        document,
        content: contentCall.status === 404
          ? { contentHtml: '', updatedAt: null }
          : normalizeDocumentContent(contentCall.result),
      })
    } catch (error) {
      if (requestSequence.current !== requestId) return
      setState({ status: 'error', message: error instanceof Error ? error.message : t('documents.editor.error.load') })
    }
  }, [documentId, t])

  React.useEffect(() => {
    void loadDocument()
    return () => { requestSequence.current += 1 }
  }, [loadDocument])

  const reloadEditor = React.useCallback(async () => {
    const requestId = ++requestSequence.current
    const contentCall = await apiCall<unknown>(`/api/documents/${encodeURIComponent(documentId)}/content`)
    if (requestSequence.current !== requestId) {
      throw new Error(t('documents.editor.error.loadContent'))
    }
    if (!contentCall.ok && contentCall.status !== 404) {
      throw new Error(t('documents.editor.error.loadContent'))
    }
    const nextContent = contentCall.status === 404
      ? { contentHtml: '', updatedAt: null }
      : normalizeDocumentContent(contentCall.result)
    setState((current) => current.status === 'ready' ? {
      ...current,
      content: nextContent,
    } : current)
    setEditor(null)
    setEditorEpoch((current) => current + 1)
  }, [documentId, t])

  const handleContentConflict = React.useCallback(() => {
    void reloadEditor().catch((error) => {
      flash(error instanceof Error ? error.message : t('documents.editor.error.loadContent'), 'error')
    })
  }, [reloadEditor, t])

  const retryEditorIsland = React.useCallback(() => {
    setEditor(null)
    setEditorEpoch((current) => current + 1)
  }, [])

  const setDocumentState = React.useCallback((mutate: (document: DocumentDetail) => DocumentDetail) => {
    setState((current) => current.status === 'ready'
      ? { ...current, document: mutate(current.document) }
      : current)
  }, [])

  const pendingToggles = React.useRef<Set<'favorite' | 'watch'>>(new Set())
  const runPersonalToggle = React.useCallback(async (
    kind: 'favorite' | 'watch',
    active: boolean,
  ) => {
    if (state.status !== 'ready' || pendingToggles.current.has(kind)) return
    pendingToggles.current.add(kind)
    const flag = kind === 'favorite' ? 'isFavorite' as const : 'isWatching' as const
    setDocumentState((document) => ({ ...document, [flag]: active }))
    try {
      await runMutation({
        operation: () => apiCallOrThrow(
          `/api/documents/${encodeURIComponent(documentId)}/${kind}`,
          { method: active ? 'POST' : 'DELETE' },
        ),
        context: {
          formId: mutationContextId,
          resourceKind: kind === 'favorite' ? 'documents.document_favorite' : 'documents.document_watcher',
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: { documentId, active },
      })
    } catch (error) {
      setDocumentState((document) => ({ ...document, [flag]: !active }))
      flash(error instanceof Error ? error.message : t('documents.editor.error.load'), 'error')
    } finally {
      pendingToggles.current.delete(kind)
    }
  }, [documentId, mutationContextId, retryLastMutation, runMutation, setDocumentState, state.status, t])

  const duplicating = React.useRef(false)
  const [isDuplicating, setIsDuplicating] = React.useState(false)
  const handleDuplicate = React.useCallback(async () => {
    if (state.status !== 'ready' || duplicating.current) return
    duplicating.current = true
    setIsDuplicating(true)
    try {
      const created = await runMutation({
        operation: () => apiCallOrThrow<{ id: string }>(
          `/api/documents/${encodeURIComponent(documentId)}/duplicate`,
          { method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' } },
        ),
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document',
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: { action: 'duplicate', sourceDocumentId: documentId },
      })
      flash(t('documents.duplicate.success'), 'success')
      const createdId = created?.result?.id
      if (createdId) router.push(`/backend/documents/${encodeURIComponent(createdId)}`)
    } catch (error) {
      flash(error instanceof Error ? error.message : t('documents.duplicate.error'), 'error')
    } finally {
      duplicating.current = false
      setIsDuplicating(false)
    }
  }, [documentId, mutationContextId, retryLastMutation, router, runMutation, state.status, t])

  const handleArchiveToggle = React.useCallback(async () => {
    if (state.status !== 'ready' || !state.document.capabilities.canArchive) return
    const archived = state.document.archivedAt !== null
    const action = archived ? 'unarchive' : 'archive'
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(state.document.updatedAt),
          () => apiCallOrThrow(`/api/documents/${encodeURIComponent(documentId)}/${action}`, { method: 'POST' }),
        ),
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document',
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: { action, documentId },
      })
      flash(t(archived ? 'documents.archive.success.unarchive' : 'documents.archive.success.archive'), 'success')
      await loadDocument()
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: () => { void loadDocument() } })) {
        flash(error instanceof Error ? error.message : t('documents.archive.error'), 'error')
      }
    }
  }, [documentId, loadDocument, mutationContextId, retryLastMutation, runMutation, state, t])

  const handleDelete = React.useCallback(async () => {
    if (state.status !== 'ready' || !state.document.capabilities.canDelete) return
    const confirmed = await confirm({
      title: t('documents.list.confirmDelete', { title: state.document.title }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(state.document.updatedAt),
          () => apiCallOrThrow(`/api/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }),
        ),
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document',
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: { id: documentId },
      })
      flash(t('documents.list.success.delete'), 'success')
      router.push('/backend/documents')
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: () => { void loadDocument() } })) {
        flash(error instanceof Error ? error.message : t('documents.list.error.delete'), 'error')
      }
    }
  }, [confirm, documentId, loadDocument, mutationContextId, retryLastMutation, router, runMutation, state, t])

  if (state.status !== 'ready') {
    if (state.status === 'notFound') {
      return (
        <Page><PageBody>
          <RecordNotFoundState
            label={t('documents.editor.notFound')}
            backHref="/backend/documents"
            backLabel={t('documents.actions.backToList')}
          />
        </PageBody></Page>
      )
    }
    const label = state.status === 'loading' ? t('documents.editor.loading') : state.message
    return (
      <Page><PageBody>
        {state.status === 'loading' ? <LoadingMessage label={label} /> : (
          <ErrorMessage label={label} action={(
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void loadDocument()}>{t('documents.actions.retry')}</Button>
              <LinkButton asChild variant="gray"><Link href="/backend/documents">{t('documents.actions.backToList')}</Link></LinkButton>
            </div>
          )} />
        )}
      </PageBody></Page>
    )
  }

  const { document, content } = state
  const capabilities = document.capabilities
  return (
    <Page>
      <PageHeader title={t('documents.nav.document')} actions={(
        <>
          <LinkButton asChild variant="gray"><Link href="/backend/documents">{t('documents.actions.backToList')}</Link></LinkButton>
          <IconButton
            type="button"
            variant="outline"
            onClick={() => void runPersonalToggle('favorite', !document.isFavorite)}
            aria-pressed={document.isFavorite}
            aria-label={t(document.isFavorite ? 'documents.actions.unfavorite' : 'documents.actions.favorite')}
          >
            <Star />
          </IconButton>
          <IconButton
            type="button"
            variant="outline"
            onClick={() => void runPersonalToggle('watch', !document.isWatching)}
            aria-pressed={document.isWatching}
            aria-label={t(document.isWatching ? 'documents.actions.unwatch' : 'documents.actions.watch')}
          >
            <Bell />
          </IconButton>
          <Button type="button" variant={showVersions ? 'secondary' : 'outline'} onClick={() => setShowVersions((value) => !value)} aria-pressed={showVersions}>
            <History />{t('documents.actions.versions')}
          </Button>
          <ExportMenu documentId={document.id} editor={editor} />
          {capabilities.canDuplicate ? (
            <Button type="button" variant="outline" disabled={isDuplicating} onClick={() => void handleDuplicate()}>
              <Copy />{t('documents.actions.duplicate')}
            </Button>
          ) : null}
          {capabilities.canArchive ? (
            <Button type="button" variant="outline" onClick={() => void handleArchiveToggle()}>
              {document.archivedAt ? <ArchiveRestore /> : <Archive />}
              {t(document.archivedAt ? 'documents.actions.unarchive' : 'documents.actions.archive')}
            </Button>
          ) : null}
          {capabilities.canShare ? <Button type="button" variant="outline" onClick={() => setShareOpen(true)}>{t('documents.actions.share')}</Button> : null}
          {capabilities.canDelete ? <Button type="button" variant="destructive" onClick={() => void handleDelete()}><Trash2 />{t('documents.actions.delete')}</Button> : null}
        </>
      )} />
      <PageBody>
        {document.archivedAt ? (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-warning-border bg-status-warning-bg px-4 py-3 text-sm text-status-warning-text"
          >
            <span>{t('documents.archive.banner')}</span>
            {capabilities.canArchive ? (
              <Button type="button" variant="outline" onClick={() => void handleArchiveToggle()}>
                <ArchiveRestore />{t('documents.actions.unarchive')}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-4 xl:flex-row">
          <div className="min-w-0 flex-1">
            <DocumentEditorErrorBoundary
              resetKey={`${document.id}:${editorEpoch}`}
              onRetry={retryEditorIsland}
              fallback={(retry) => (
                <ErrorMessage
                  label={t('documents.editor.error.load')}
                  action={<Button type="button" variant="outline" onClick={retry}>{t('documents.actions.retry')}</Button>}
                />
              )}
            >
              <DocumentEditorIsland
                key={`${document.id}:${editorEpoch}`}
                documentId={document.id}
                title={document.title}
                initialContentHtml={content.contentHtml}
                contentUpdatedAt={content.updatedAt}
                documentUpdatedAt={document.updatedAt}
                readOnly={!capabilities.canEdit}
                onEditorReady={setEditor}
                onContentConflict={handleContentConflict}
                onComment={capabilities.canComment ? (anchor) => setCommentFocusRequest((current) => ({ anchor, requestId: (current?.requestId ?? 0) + 1 })) : undefined}
                onTitleChange={(title, updatedAt) => setState((current) => current.status === 'ready' ? {
                  ...current,
                  document: { ...current.document, title, updatedAt },
                } : current)}
              />
            </DocumentEditorErrorBoundary>
          </div>
          <aside className="space-y-4 xl:sticky xl:top-[calc(var(--topbar-height,0px)+1rem)] xl:max-h-[calc(100dvh-var(--topbar-height,0px)-2rem)] xl:w-80 xl:shrink-0 xl:self-start xl:overflow-y-auto">
            <DocumentNavigator editor={editor} />
            <RelatedRecordsPanel documentId={document.id} canEdit={capabilities.canEdit} editor={editor} />
            <CommentsRail
              documentId={document.id}
              editor={editor}
              commentFocusRequest={commentFocusRequest}
              canComment={capabilities.canComment}
              canShare={capabilities.canShare}
            />
            {showVersions ? (
              <VersionHistoryPanel
                documentId={document.id}
                canRestore={capabilities.canEdit}
                contentUpdatedAt={content.updatedAt}
                onRestored={reloadEditor}
              />
            ) : null}
          </aside>
        </div>
      </PageBody>
      {capabilities.canShare ? (
        <ShareDialog
          documentId={document.id}
          open={shareOpen}
          onOpenChange={setShareOpen}
          canManage={capabilities.canShare}
        />
      ) : null}
      {ConfirmDialogElement}
    </Page>
  )
}

export default DocumentPageClient
