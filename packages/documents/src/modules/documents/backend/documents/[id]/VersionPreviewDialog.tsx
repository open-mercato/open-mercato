"use client"

import * as React from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { RotateCcw } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { getDocumentEditorExtensions } from '../../../lib/editorConfig'
import { firstSafeDocumentsDisplayLabel } from '../../../lib/displayLabels'
import { sanitizeDocumentVersionLabel } from '../../../lib/versionLabels'
import { readRecord, readString } from '../documentUi'
import { DOCUMENT_EDITOR_CONTENT_CLASS } from './editorTypes'

export type VersionPreview = {
  id: string
  label: string | null
  creatorLabel: string
  createdAt: string
  contentHtml: string
}

type VersionPreviewDialogProps = {
  documentId: string
  versionId: string | null
  canRestore: boolean
  isRestoring: boolean
  onOpenChange: (open: boolean) => void
  onRestore: (version: VersionPreview) => void | Promise<void>
}

export function normalizeVersionPreview(
  payload: unknown,
  fallbackCreatorLabel?: string,
): VersionPreview | null {
  const root = readRecord(payload)
  const record = readRecord(root?.item) ?? readRecord(root?.data) ?? root
  if (!record) return null
  const id = readString(record, 'id')
  const creatorLabel = firstSafeDocumentsDisplayLabel(
    readString(record, 'creatorLabel', 'creator_label'),
    fallbackCreatorLabel,
  )
  const createdAt = readString(record, 'createdAt', 'created_at')
  if (!id || !creatorLabel || !createdAt) return null
  return {
    id,
    creatorLabel,
    createdAt,
    label: sanitizeDocumentVersionLabel(readString(record, 'label')),
    contentHtml: readString(record, 'contentHtml', 'content_html') ?? '',
  }
}

function ReadOnlyVersion({ contentHtml, fallbackLabel }: { contentHtml: string; fallbackLabel: string }) {
  const editor = useEditor({
    extensions: getDocumentEditorExtensions({ entityRefFallbackLabel: fallbackLabel }),
    content: contentHtml,
    editable: false,
    editorProps: { attributes: { class: 'min-h-64 text-base leading-7 text-foreground focus-visible:outline-none' } },
  }, [contentHtml])
  React.useEffect(() => { editor?.commands.setContent(contentHtml) }, [contentHtml, editor])
  // Share the live editor's typography so tables keep their grid lines and
  // headings/lists read the same in the preview as on the canvas.
  return <EditorContent editor={editor} className={cn(DOCUMENT_EDITOR_CONTENT_CLASS, 'rounded-md border border-border bg-card p-4')} />
}

export function VersionPreviewDialog({
  documentId,
  versionId,
  canRestore,
  isRestoring,
  onOpenChange,
  onRestore,
}: VersionPreviewDialogProps) {
  const t = useT()
  const [preview, setPreview] = React.useState<VersionPreview | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadAttempt, setLoadAttempt] = React.useState(0)
  const [confirmingRestore, setConfirmingRestore] = React.useState(false)
  const cancelRestoreRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    setConfirmingRestore(false)
    if (!versionId) { setPreview(null); setError(null); return }
    let active = true
    setLoading(true)
    setError(null)
    void apiCall<unknown>(`/api/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}`)
      .then((call) => {
        if (!active) return
        const next = call.ok
          ? normalizeVersionPreview(call.result, t('documents.users.unknown'))
          : null
        if (!next) setError(t('documents.versions.preview.error'))
        setPreview(next)
      })
      .catch(() => { if (active) setError(t('documents.versions.preview.error')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [documentId, loadAttempt, t, versionId])

  React.useEffect(() => {
    if (confirmingRestore) cancelRestoreRef.current?.focus()
  }, [confirmingRestore])

  const requestRestore = React.useCallback(() => {
    if (!canRestore || !preview || isRestoring) return
    setConfirmingRestore(true)
  }, [canRestore, isRestoring, preview])

  const confirmRestore = React.useCallback(() => {
    if (!canRestore || !preview || isRestoring) return
    void onRestore(preview)
  }, [canRestore, isRestoring, onRestore, preview])

  const handleOpenChange = React.useCallback((open: boolean) => {
    if (!open) setConfirmingRestore(false)
    onOpenChange(open)
  }, [onOpenChange])

  return (
    <Dialog open={versionId !== null} onOpenChange={handleOpenChange}>
      <DialogContent size="xl" onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (confirmingRestore) {
            event.preventDefault()
            event.stopPropagation()
            if (!isRestoring) setConfirmingRestore(false)
          } else {
            onOpenChange(false)
          }
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canRestore && preview && !isRestoring) {
          event.preventDefault()
          if (confirmingRestore) confirmRestore()
          else requestRestore()
        }
      }}>
        <DialogHeader>
          <DialogTitle>
            {confirmingRestore
              ? t('documents.versions.restore.confirmTitle')
              : preview?.label ?? t('documents.versions.preview.title')}
          </DialogTitle>
          <DialogDescription aria-live={confirmingRestore ? 'assertive' : undefined}>
            {confirmingRestore
              ? t('documents.versions.restore.confirmBody')
              : preview
                ? t('documents.versions.preview.description', { creator: preview.creatorLabel, date: new Date(preview.createdAt).toLocaleString() })
                : t('documents.versions.preview.loading')}
          </DialogDescription>
        </DialogHeader>
        {!confirmingRestore && loading ? <LoadingMessage label={t('documents.versions.preview.loading')} /> : null}
        {!confirmingRestore && error ? (
          <ErrorMessage
            label={error}
            action={<Button type="button" size="sm" variant="outline" onClick={() => setLoadAttempt((current) => current + 1)}>{t('documents.actions.retry')}</Button>}
          />
        ) : null}
        {!confirmingRestore && preview && !loading && !error ? <ReadOnlyVersion contentHtml={preview.contentHtml} fallbackLabel={t('documents.editor.entityRef.fallbackLabel')} /> : null}
        <DialogFooter>
          {confirmingRestore ? (
            <>
              <Button ref={cancelRestoreRef} type="button" variant="outline" onClick={() => setConfirmingRestore(false)} disabled={isRestoring}>
                {t('documents.actions.cancel')}
              </Button>
              <Button type="button" onClick={confirmRestore} disabled={isRestoring}>
                <RotateCcw />{t('documents.versions.actions.restore')}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('documents.actions.close')}</Button>
              {canRestore && preview ? (
                <Button type="button" onClick={requestRestore} disabled={isRestoring}>
                  <RotateCcw />{t('documents.versions.actions.restore')}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
