"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { History, Trash2 } from 'lucide-react'
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
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ShareDialog } from '../components/ShareDialog'
import { normalizeDocumentContent, normalizeDocumentDetail, type DocumentContent, type DocumentDetail } from '../documentUi'
import { CommentsRail } from './CommentsRail'
import type { CommentAnchor } from './CommentAnchorNavigation'
import { ExportMenu } from './ExportMenu'
import { RelatedRecordsPanel } from './RelatedRecordsPanel'
import { DocumentNavigator } from './DocumentNavigator'
import { VersionHistoryPanel } from './VersionHistoryPanel'

const DocumentEditorIsland = dynamic(() => import('./DocumentEditorIsland'), { ssr: false, loading: () => null })

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
    setEditor(null)
    const contentCall = await apiCall<unknown>(`/api/documents/${encodeURIComponent(documentId)}/content`)
    if (requestSequence.current !== requestId) return
    if (contentCall.ok || contentCall.status === 404) {
      setState((current) => current.status === 'ready' ? {
        ...current,
        content: contentCall.status === 404
          ? { contentHtml: '', updatedAt: null }
          : normalizeDocumentContent(contentCall.result),
      } : current)
    }
    setEditorEpoch((current) => current + 1)
  }, [documentId])

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
            <Button asChild variant="outline"><Link href="/backend/documents">{t('documents.actions.backToList')}</Link></Button>
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
          <Button asChild variant="outline"><Link href="/backend/documents">{t('documents.actions.backToList')}</Link></Button>
          <Button type="button" variant={showVersions ? 'secondary' : 'outline'} onClick={() => setShowVersions((value) => !value)} aria-pressed={showVersions}>
            <History />{t('documents.actions.versions')}
          </Button>
          <ExportMenu documentId={document.id} editor={editor} />
          {capabilities.canShare ? <Button type="button" variant="outline" onClick={() => setShareOpen(true)}>{t('documents.actions.share')}</Button> : null}
          {capabilities.canDelete ? <Button type="button" variant="destructive" onClick={() => void handleDelete()}><Trash2 />{t('documents.actions.delete')}</Button> : null}
        </>
      )} />
      <PageBody>
        <div className="flex flex-col gap-4 xl:flex-row">
          <div className="min-w-0 flex-1">
            <DocumentEditorIsland
              key={`${document.id}:${editorEpoch}`}
              documentId={document.id}
              title={document.title}
              initialContentHtml={content.contentHtml}
              documentUpdatedAt={document.updatedAt}
              readOnly={!capabilities.canEdit}
              onEditorReady={setEditor}
              onComment={capabilities.canComment ? (anchor) => setCommentFocusRequest((current) => ({ anchor, requestId: (current?.requestId ?? 0) + 1 })) : undefined}
              onTitleChange={(title, updatedAt) => setState((current) => current.status === 'ready' ? {
                ...current,
                document: { ...current.document, title, updatedAt },
              } : current)}
            />
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
