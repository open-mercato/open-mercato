"use client"

import * as React from 'react'
import { Link2, Unlink } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { EntityPicker } from '../components/EntityPicker'
import { DocumentCanvas } from './DocumentCanvas'
import { EditorStatusPresence } from './EditorStatusPresence'
import { EditorToolbar } from './EditorToolbar'
import { RecordFieldsDialog } from './RecordFieldsDialog'
import { EDITOR_PRESENCE_STYLES } from './editorPresenceStyles'
import { canCreateSelectionComment, type CollabResources, type ConnectionStatus, type DocumentEditorIslandProps, type EditorMode, type PresenceUser } from './editorTypes'
import { useDocumentEditor } from './useDocumentEditor'
import { useFallbackContentPersistence } from './useFallbackContentPersistence'
import { useDocumentTitle } from './useDocumentTitle'
import { useEditorInsertions } from './useEditorInsertions'

type Props = DocumentEditorIslandProps & {
  transport: 'collab' | 'fallback'
  collabResources?: CollabResources
  connectionStatus: ConnectionStatus
  presenceUsers: PresenceUser[]
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
}

export function DocumentEditorSurface(input: Props) {
  const t = useT()
  const [outlineOpen, setOutlineOpen] = React.useState(false)
  const [suggestionRange, setSuggestionRange] = React.useState<{ from: number; to: number } | null>(null)
  const modeChangeInFlightRef = React.useRef(false)
  const effectiveReadOnly = input.readOnly || input.mode === 'preview'
  const openSuggestion = React.useCallback((range: { from: number; to: number }) => setSuggestionRange(range), [])
  const closeSuggestion = React.useCallback(() => setSuggestionRange(null), [])
  const fallbackPersistence = useFallbackContentPersistence({
    documentId: input.documentId,
    initialUpdatedAt: input.contentUpdatedAt ?? null,
    enabled: input.transport === 'fallback' && !input.readOnly,
    onConflictRefresh: input.onContentConflict,
  })
  const editorModel = useDocumentEditor({
    documentId: input.documentId,
    initialContentHtml: input.initialContentHtml,
    editorMode: input.transport,
    collabResources: input.collabResources,
    readOnly: effectiveReadOnly,
    onEditorReady: input.onEditorReady,
    onUpdate: fallbackPersistence.onEditorUpdate,
    onEntitySuggestion: openSuggestion,
    onSuggestionClose: closeSuggestion,
  })
  const title = useDocumentTitle({
    documentId: input.documentId,
    title: input.title,
    updatedAt: input.documentUpdatedAt ?? null,
    readOnly: effectiveReadOnly,
    onTitleChange: input.onTitleChange,
  })
  const insertions = useEditorInsertions({
    documentId: input.documentId,
    editorRef: editorModel.editorRef,
    disabled: effectiveReadOnly,
    suggestionRange,
    setSuggestionRange,
  })
  React.useEffect(() => {
    if (suggestionRange && !effectiveReadOnly) insertions.setPickerOpen(true)
  }, [effectiveReadOnly, insertions.setPickerOpen, suggestionRange])

  const status = input.transport === 'fallback' ? 'offline' : input.connectionStatus
  const notice = input.transport === 'fallback'
    ? t(input.readOnly ? 'documents.editor.realtime.readOnlyFallback' : 'documents.editor.realtime.singleUserFallback')
    : input.readOnly
      ? t('documents.editor.readOnly')
      : input.mode === 'preview'
        ? t('documents.editor.mode.previewNotice')
        : null
  const selectionCommentHandler = canCreateSelectionComment({
    permissionReadOnly: input.readOnly,
    mode: input.mode,
    transport: input.transport,
    hasCommentHandler: Boolean(input.onComment),
  }) ? input.onComment : undefined
  const handleModeChange = React.useCallback(async (nextMode: EditorMode) => {
    if (nextMode === input.mode || modeChangeInFlightRef.current) return
    if (input.transport !== 'fallback' || nextMode !== 'preview') {
      input.onModeChange(nextMode)
      return
    }

    modeChangeInFlightRef.current = true
    try {
      if (await fallbackPersistence.saveNow()) input.onModeChange(nextMode)
    } finally {
      modeChangeInFlightRef.current = false
    }
  }, [fallbackPersistence.saveNow, input.mode, input.onModeChange, input.transport])

  return (
    <div className={cn('space-y-3', input.transport === 'collab' && 'om-doc-collab', input.mode === 'preview' && 'om-doc-preview')}>
      <style>{EDITOR_PRESENCE_STYLES}</style>
      <div className="overflow-hidden rounded-lg border border-border bg-muted shadow-sm">
        <div className="sticky top-0 z-sticky border-b border-border bg-card/95">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <EditorStatusPresence
              status={status}
              users={input.presenceUsers}
              counts={editorModel.counts}
              mode={input.mode}
              canEdit={!input.readOnly}
              onModeChange={(nextMode) => { void handleModeChange(nextMode) }}
              fallbackSave={input.transport === 'fallback' && !input.readOnly ? {
                status: fallbackPersistence.status,
                onSave: fallbackPersistence.saveNow,
              } : undefined}
            />
          </div>
          {input.mode === 'edit' ? (
            <EditorToolbar
              editor={editorModel.editor}
              disabled={effectiveReadOnly || !editorModel.editor}
              outlineOpen={outlineOpen}
              uploading={insertions.uploading}
              onToggleOutline={() => setOutlineOpen((value) => !value)}
              onOpenEntityPicker={insertions.openEntityPicker}
              onOpenLink={insertions.openLink}
              onImage={() => insertions.fileInputRef.current?.click()}
            />
          ) : null}
          {insertions.linkOpen && !effectiveReadOnly ? (
            <div className="flex flex-col gap-3 border-t border-border bg-muted/30 p-3 md:flex-row md:items-end" onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); insertions.applyLink() }
              if (event.key === 'Escape') { event.preventDefault(); insertions.setLinkOpen(false) }
            }}>
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor={`document-link-${input.documentId}`}>{t('documents.editor.link.url')}</Label>
                <Input id={`document-link-${input.documentId}`} type="url" value={insertions.linkHref} onChange={(event) => insertions.setLinkHref(event.target.value)} placeholder={t('documents.editor.link.placeholder')} />
              </div>
              <Button type="button" onClick={insertions.applyLink}><Link2 />{t('documents.editor.link.apply')}</Button>
              <Button type="button" variant="outline" onClick={insertions.removeLink}><Unlink />{t('documents.editor.link.remove')}</Button>
              <Button type="button" variant="ghost" onClick={() => insertions.setLinkOpen(false)}>{t('documents.actions.cancel')}</Button>
            </div>
          ) : null}
        </div>
        <DocumentCanvas editor={editorModel.editor} title={title} readOnly={effectiveReadOnly} outlineOpen={outlineOpen} notice={notice} onOpenLink={insertions.openLink} onComment={selectionCommentHandler} />
      </div>
      <EntityPicker open={insertions.entityPickerOpen} onOpenChange={insertions.setPickerOpen} onPick={(pick) => { void insertions.handleEntityPick(pick) }} />
      <RecordFieldsDialog
        documentId={input.documentId}
        linkId={insertions.recordFieldsLinkId}
        editor={editorModel.editor}
        canInsert={!effectiveReadOnly && Boolean(editorModel.editor)}
        onOpenChange={(open) => { if (!open) insertions.closeRecordFields() }}
      />
      <input ref={insertions.fileInputRef} type="file" accept="image/*" className="hidden" aria-label={t('documents.editor.imageInput')} onChange={(event) => { void insertions.handleFiles(event.target.files) }} />
    </div>
  )
}
