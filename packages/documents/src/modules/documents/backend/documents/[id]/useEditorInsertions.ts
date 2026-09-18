"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { EntityRefAttributes } from '../../../lib/editorConfig'
import { insertEntityRef } from '../../../lib/entitySuggestion'
import type { EntityPickerSelection } from '../components/EntityPicker'
import type { EditorSelectionRange } from './editorTypes'

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readAttachmentUrl(documentId: string, payload: unknown): string | null {
  const root = readRecord(payload)
  if (!root) return null
  const records = [root, readRecord(root.item), readRecord(root.attachment)].filter((value): value is Record<string, unknown> => value !== null)
  for (const record of records) {
    const value = record.documentUrl ?? record.document_url ?? record.proxyUrl ?? record.proxy_url ?? record.url
    if (typeof value === 'string' && value.includes(`/api/documents/${documentId}/attachments/`)) return value
  }
  const id = records.map((record) => record.attachmentId ?? record.attachment_id ?? record.id).find((value) => typeof value === 'string')
  return typeof id === 'string' ? `/api/documents/${encodeURIComponent(documentId)}/attachments/${encodeURIComponent(id)}` : null
}

export function useEditorInsertions(input: {
  documentId: string
  editorRef: React.RefObject<Editor | null>
  disabled: boolean
  suggestionRange: EditorSelectionRange | null
  setSuggestionRange: (range: EditorSelectionRange | null) => void
}) {
  const t = useT()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [linkHref, setLinkHref] = React.useState('')
  const [entityPickerOpen, setEntityPickerOpen] = React.useState(false)
  const [recordFieldsLinkId, setRecordFieldsLinkId] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const mutationContextId = `documents-insertions:${input.documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const openLink = React.useCallback(() => {
    const editor = input.editorRef.current
    if (!editor || input.disabled) return
    const href = editor.getAttributes('link').href
    setLinkHref(typeof href === 'string' ? href : '')
    setLinkOpen(true)
  }, [input.disabled, input.editorRef])

  const applyLink = React.useCallback(() => {
    const editor = input.editorRef.current
    if (!editor || input.disabled) return
    const href = linkHref.trim()
    if (href) {
      // TipTap rejects a disallowed URI scheme by returning false instead of
      // throwing. Closing regardless would drop the user's link without a word.
      if (!editor.chain().focus().extendMarkRange('link').setLink({ href }).run()) {
        flash(t('documents.editor.link.rejected'), 'error')
        return
      }
    } else {
      editor.chain().focus().unsetLink().run()
    }
    setLinkOpen(false)
  }, [input.disabled, input.editorRef, linkHref, t])

  const removeLink = React.useCallback(() => {
    input.editorRef.current?.chain().focus().unsetLink().run()
    setLinkOpen(false)
  }, [input.editorRef])

  const handleFiles = React.useCallback(async (files: FileList | null) => {
    const file = files?.item(0)
    const editor = input.editorRef.current
    if (!file || !editor || input.disabled) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.set('file', file)
      const call = await runMutation({
        operation: () => apiCallOrThrow(
          `/api/documents/${encodeURIComponent(input.documentId)}/attachments`,
          { method: 'POST', body: formData },
          { errorMessage: t('documents.editor.error.imageUpload') },
        ),
        context: { formId: mutationContextId, resourceKind: 'documents.document_attachment', resourceId: input.documentId, retryLastMutation },
        mutationPayload: { fileName: file.name, fileType: file.type },
      })
      const url = readAttachmentUrl(input.documentId, call.result)
      if (!url) throw new Error(t('documents.editor.error.imageUpload'))
      editor.chain().focus().setImage({ src: url }).run()
    } catch (error) { flash(error instanceof Error ? error.message : t('documents.editor.error.imageUpload'), 'error') }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }, [input.disabled, input.documentId, input.editorRef, mutationContextId, retryLastMutation, runMutation, t])

  const handleEntityPick = React.useCallback(async (pick: EntityPickerSelection) => {
    const editor = input.editorRef.current
    if (!editor || input.disabled) return
    try {
      const call = await runMutation({
        operation: () => apiCallOrThrow(
          `/api/documents/${encodeURIComponent(input.documentId)}/links`,
          {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ entityType: pick.type, entityId: pick.id, label: pick.label, href: pick.href, source: 'chip' }),
          },
          { errorMessage: t('documents.relatedRecords.error.link') },
        ),
        context: { formId: mutationContextId, resourceKind: 'documents.document_entity_link', resourceId: input.documentId, retryLastMutation },
        mutationPayload: { entityType: pick.type, entityId: pick.id },
      })
      const linkId = readRecord(call.result)?.id
      if (typeof linkId !== 'string' || linkId.length === 0) {
        throw new Error(t('documents.relatedRecords.error.link'))
      }
      const attrs: EntityRefAttributes = { entityType: pick.type, entityId: pick.id, label: pick.label, href: pick.href }
      if (input.suggestionRange) editor.chain().focus().deleteRange(input.suggestionRange).run()
      insertEntityRef(editor, attrs)
      setEntityPickerOpen(false)
      setRecordFieldsLinkId(linkId)
      input.setSuggestionRange(null)
    } catch (error) { flash(error instanceof Error ? error.message : t('documents.relatedRecords.error.link'), 'error') }
  }, [input.disabled, input.documentId, input.editorRef, input.setSuggestionRange, input.suggestionRange, mutationContextId, retryLastMutation, runMutation, t])

  const setPickerOpen = React.useCallback((open: boolean) => {
    setEntityPickerOpen(open)
    if (!open) input.setSuggestionRange(null)
  }, [input.setSuggestionRange])

  return {
    fileInputRef, uploading, handleFiles, linkOpen, setLinkOpen, linkHref, setLinkHref,
    openLink, applyLink, removeLink, entityPickerOpen, setPickerOpen,
    openEntityPicker: () => { input.setSuggestionRange(null); setEntityPickerOpen(true) },
    handleEntityPick, recordFieldsLinkId,
    closeRecordFields: () => setRecordFieldsLinkId(null),
  }
}
