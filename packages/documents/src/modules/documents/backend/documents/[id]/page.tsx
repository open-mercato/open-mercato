"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { History } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ShareDialog } from '../components/ShareDialog'
import { CommentsRail } from './CommentsRail'
import { ExportMenu } from './ExportMenu'
import { VersionHistoryPanel } from './VersionHistoryPanel'

const DocumentEditorIsland = dynamic(() => import('./DocumentEditorIsland'), {
  ssr: false,
  loading: () => null,
})

type DocumentTier = 'owner' | 'editor' | 'commenter' | 'viewer'

type DocumentDetail = {
  id: string
  title: string
  tier: DocumentTier
  updatedAt?: string | null
  canShare: boolean
}

type DocumentContent = {
  contentHtml: string
  updatedAt?: string | null
}

type CommentSelection = {
  from: number
  to: number
}

type CommentFocusRequest = {
  anchor: CommentSelection
  requestId: number
}

type LoadState =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'error'; message: string }
  | { status: 'ready'; document: DocumentDetail; content: DocumentContent }

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

function readBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  return null
}

function readDocumentTier(value: string | null): DocumentTier {
  if (value === 'owner' || value === 'editor' || value === 'commenter') return value
  return 'viewer'
}

function unwrapRecord(payload: unknown, ...keys: string[]): Record<string, unknown> | null {
  const root = readRecord(payload)
  if (!root) return null
  for (const key of keys) {
    const nested = readRecord(root[key])
    if (nested) return nested
  }
  return root
}

function normalizeDocument(payload: unknown): DocumentDetail | null {
  const record = unwrapRecord(payload, 'document', 'item', 'data')
  if (!record) return null
  const id = readString(record, 'id')
  const title = readString(record, 'title')
  if (!id || !title) return null
  const tier = readDocumentTier(readString(record, 'tier', 'permission', 'effectiveTier', 'effective_tier'))
  return {
    id,
    title,
    tier,
    updatedAt: readString(record, 'updatedAt', 'updated_at'),
    canShare: readBoolean(record, 'canShare', 'can_share') ?? tier === 'owner',
  }
}

function normalizeContent(payload: unknown): DocumentContent {
  const record = unwrapRecord(payload, 'content', 'item', 'data')
  if (!record) return { contentHtml: '' }
  return {
    contentHtml: readString(record, 'contentHtml', 'content_html') ?? '',
    updatedAt: readString(record, 'updatedAt', 'updated_at'),
  }
}

function resolveDocumentId(paramId: string | undefined, pathname: string | null): string | null {
  if (typeof paramId === 'string' && paramId.trim().length > 0) return paramId
  if (pathname) {
    const segments = pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    if (last && last !== 'documents') return decodeURIComponent(last)
  }
  return null
}

export default function DocumentEditorPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const pathname = usePathname()
  const documentId = resolveDocumentId(params?.id, pathname)
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })
  const [shareOpen, setShareOpen] = React.useState(false)
  const [showVersions, setShowVersions] = React.useState(false)
  const [editorEpoch, setEditorEpoch] = React.useState(0)
  const [editor, setEditor] = React.useState<import('@tiptap/core').Editor | null>(null)
  const [commentFocusRequest, setCommentFocusRequest] = React.useState<CommentFocusRequest | null>(null)

  React.useEffect(() => {
    if (!documentId) {
      setState({ status: 'notFound' })
      return
    }
    const currentDocumentId = documentId
    let cancelled = false
    async function loadDocument() {
      setState({ status: 'loading' })
      try {
        const [documentCall, contentCall] = await Promise.all([
          apiCall<unknown>(`/api/documents/${encodeURIComponent(currentDocumentId)}`),
          apiCall<unknown>(`/api/documents/${encodeURIComponent(currentDocumentId)}/content`),
        ])
        if (cancelled) return
        if (documentCall.status === 404) {
          setState({ status: 'notFound' })
          return
        }
        if (!documentCall.ok) {
          setState({ status: 'error', message: t('documents.editor.error.load') })
          return
        }
        if (!contentCall.ok && contentCall.status !== 404) {
          setState({ status: 'error', message: t('documents.editor.error.loadContent') })
          return
        }
        const document = normalizeDocument(documentCall.result)
        if (!document) {
          setState({ status: 'error', message: t('documents.editor.error.load') })
          return
        }
        setState({
          status: 'ready',
          document,
          content: contentCall.status === 404 ? { contentHtml: '' } : normalizeContent(contentCall.result),
        })
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : t('documents.editor.error.load'),
          })
        }
      }
    }
    void loadDocument()
    return () => {
      cancelled = true
    }
  }, [documentId, t])

  React.useEffect(() => {
    setCommentFocusRequest(null)
  }, [documentId])

  const reloadEditor = React.useCallback(() => {
    if (!documentId) return
    setEditor(null)
    void apiCall<unknown>(`/api/documents/${encodeURIComponent(documentId)}/content`)
      .then((contentCall) => {
        if (!contentCall.ok && contentCall.status !== 404) return
        setState((current) => {
          if (current.status !== 'ready') return current
          return {
            ...current,
            content: contentCall.status === 404 ? { contentHtml: '' } : normalizeContent(contentCall.result),
          }
        })
      })
      .finally(() => setEditorEpoch((current) => current + 1))
  }, [documentId])

  const handleEditorComment = React.useCallback((selection: CommentSelection) => {
    setCommentFocusRequest((current) => ({
      anchor: selection,
      requestId: (current?.requestId ?? 0) + 1,
    }))
  }, [])

  if (state.status === 'loading') {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('documents.editor.loading')} />
        </PageBody>
      </Page>
    )
  }

  if (state.status === 'notFound') {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t('documents.editor.notFound')}
            action={(
              <Button asChild variant="outline">
                <Link href="/backend/documents">{t('documents.actions.backToList')}</Link>
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  if (state.status === 'error') {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={state.message}
            action={(
              <Button asChild variant="outline">
                <Link href="/backend/documents">{t('documents.actions.backToList')}</Link>
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  const readOnly = state.document.tier === 'viewer' || state.document.tier === 'commenter'
  const canComment = state.document.tier !== 'viewer'

  return (
    <Page>
      <PageHeader
        title={t('documents.nav.document')}
        actions={(
          <>
            <Button asChild variant="outline">
              <Link href="/backend/documents">{t('documents.actions.backToList')}</Link>
            </Button>
            <Button
              type="button"
              variant={showVersions ? 'secondary' : 'outline'}
              onClick={() => setShowVersions((current) => !current)}
              aria-pressed={showVersions}
            >
              <History />
              {t('documents.actions.versions')}
            </Button>
            <ExportMenu documentId={state.document.id} />
            <Button type="button" variant="outline" onClick={() => setShareOpen(true)}>
              {t('documents.actions.share')}
            </Button>
          </>
        )}
      />
      <PageBody>
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="min-w-0 flex-1">
            <DocumentEditorIsland
              key={`${state.document.id}:${editorEpoch}`}
              documentId={state.document.id}
              title={state.document.title}
              initialContentHtml={state.content.contentHtml}
              initialUpdatedAt={state.content.updatedAt ?? state.document.updatedAt ?? null}
              readOnly={readOnly}
              onEditorReady={setEditor}
              onComment={canComment ? handleEditorComment : undefined}
            />
          </div>
          <aside className="space-y-4 md:w-80 md:shrink-0">
            <CommentsRail
              documentId={state.document.id}
              tier={state.document.tier}
              editor={editor}
              commentFocusRequest={commentFocusRequest}
              canShare={state.document.canShare}
            />
            {showVersions ? (
              <VersionHistoryPanel
                documentId={state.document.id}
                tier={state.document.tier}
                onRestored={reloadEditor}
              />
            ) : null}
          </aside>
        </div>
      </PageBody>
      <ShareDialog
        documentId={state.document.id}
        open={shareOpen}
        onOpenChange={setShareOpen}
        canManage={state.document.canShare}
      />
    </Page>
  )
}
