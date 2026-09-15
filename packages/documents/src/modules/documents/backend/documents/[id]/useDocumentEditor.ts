"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { useEditor } from '@tiptap/react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  activateEntityRefFromKeyboardEvent,
  activateEntityRefFromPointerEvent,
  getClientEditorExtras,
  getCollaborativeEditorExtensions,
  getDocumentEditorExtensions,
} from '../../../lib/editorConfig'
import { createEntitySuggestionExtension } from '../../../lib/entitySuggestion'
import { DocumentPagination } from './documentPagination'
import type { CollabResources, EditorSelectionRange, EditorWordCount } from './editorTypes'

type UseDocumentEditorInput = {
  documentId: string
  initialContentHtml: string
  editorMode: 'collab' | 'fallback'
  collabResources?: CollabResources
  readOnly: boolean
  onEditorReady?: (editor: Editor | null) => void
  onUpdate?: (editor: Editor) => void
  onEntitySuggestion: (range: EditorSelectionRange) => void
  onSuggestionClose: () => void
}

export const DOCUMENT_COUNT_UPDATE_DELAY_MS = 150

export function countDocumentWordsAndCharacters(doc: ProseMirrorNode): EditorWordCount {
  let words = 0
  let characters = 0
  let firstBlock = true
  let insideWord = false

  doc.nodesBetween(0, doc.content.size, (node) => {
    const nodeText = node.isText ? node.text ?? '' : node.isLeaf ? ' ' : ''
    if (node.isBlock && ((node.isLeaf && nodeText.length > 0) || node.isTextblock)) {
      if (firstBlock) firstBlock = false
      else insideWord = false
    }
    characters += nodeText.length
    for (let index = 0; index < nodeText.length; index += 1) {
      if (nodeText[index] === ' ') {
        insideWord = false
      } else if (!insideWord) {
        words += 1
        insideWord = true
      }
    }
  })
  return { words, characters }
}

function documentCounts(editor: Editor | null): EditorWordCount {
  if (!editor) return { words: 0, characters: 0 }
  return countDocumentWordsAndCharacters(editor.state.doc)
}

export function useDocumentEditor(input: UseDocumentEditorInput) {
  const t = useT()
  const editorRef = React.useRef<Editor | null>(null)
  const countTimerRef = React.useRef<number | null>(null)
  const readOnlyRef = React.useRef(input.readOnly)
  const onEntitySuggestionRef = React.useRef(input.onEntitySuggestion)
  const onSuggestionCloseRef = React.useRef(input.onSuggestionClose)
  const [counts, setCounts] = React.useState<EditorWordCount>({ words: 0, characters: 0 })
  readOnlyRef.current = input.readOnly
  onEntitySuggestionRef.current = input.onEntitySuggestion
  onSuggestionCloseRef.current = input.onSuggestionClose

  const applyCounts = React.useCallback((updated: Editor | null) => {
    const next = documentCounts(updated)
    React.startTransition(() => {
      setCounts((current) => current.words === next.words && current.characters === next.characters ? current : next)
    })
  }, [])
  const scheduleCounts = React.useCallback((updated: Editor) => {
    if (countTimerRef.current !== null) window.clearTimeout(countTimerRef.current)
    countTimerRef.current = window.setTimeout(() => {
      countTimerRef.current = null
      applyCounts(updated)
    }, DOCUMENT_COUNT_UPDATE_DELAY_MS)
  }, [applyCounts])

  const extensions = React.useMemo(() => {
    const suggestions = [createEntitySuggestionExtension({
      onTrigger: ({ range }) => {
        if (!readOnlyRef.current) onEntitySuggestionRef.current(range)
      },
      onClose: () => onSuggestionCloseRef.current(),
    })]
    return input.editorMode === 'collab' && input.collabResources
      ? [...getCollaborativeEditorExtensions({
        ydoc: input.collabResources.ydoc,
        provider: input.collabResources.provider,
        user: input.collabResources.user,
        placeholder: t('documents.editor.placeholder'),
        fallbackUserLabel: t('documents.users.unknown'),
        fallbackEntityRefLabel: t('documents.editor.entityRef.fallbackLabel'),
      }), ...getClientEditorExtras(), DocumentPagination, ...suggestions]
      : [...getDocumentEditorExtensions({
        entityRefFallbackLabel: t('documents.editor.entityRef.fallbackLabel'),
      }), ...getClientEditorExtras(), DocumentPagination, ...suggestions]
  }, [input.collabResources, input.editorMode, t])

  const editor = useEditor({
    extensions,
    content: input.editorMode === 'fallback' ? input.initialContentHtml : undefined,
    editable: !input.readOnly,
    editorProps: {
      attributes: {
        class: 'min-h-96 text-base leading-7 text-foreground focus-visible:outline-none',
        role: 'textbox',
        'aria-label': t('documents.editor.content.ariaLabel'),
        'aria-multiline': 'true',
      },
      handleClick(_view, _position, event) {
        return activateEntityRefFromPointerEvent(
          event,
          (href) => { window.open(href, '_blank', 'noopener') },
        )
      },
      handleKeyDown(_view, event) {
        return activateEntityRefFromKeyboardEvent(
          event,
          (href) => { window.open(href, '_blank', 'noopener') },
        )
      },
    },
    onCreate: ({ editor: created }) => { editorRef.current = created; applyCounts(created); input.onEditorReady?.(created) },
    onDestroy: () => {
      if (countTimerRef.current !== null) window.clearTimeout(countTimerRef.current)
      countTimerRef.current = null
      editorRef.current = null
      input.onEditorReady?.(null)
    },
    onUpdate: ({ editor: updated }) => {
      editorRef.current = updated
      scheduleCounts(updated)
      input.onUpdate?.(updated)
    },
  }, [input.documentId, input.editorMode, extensions])

  React.useEffect(() => { editorRef.current = editor; editor?.setEditable(!input.readOnly) }, [editor, input.readOnly])
  React.useEffect(() => {
    if (input.readOnly) onSuggestionCloseRef.current()
  }, [input.readOnly])
  React.useEffect(() => () => {
    if (countTimerRef.current !== null) window.clearTimeout(countTimerRef.current)
  }, [])
  React.useEffect(() => () => { input.onEditorReady?.(null) }, [input.onEditorReady])
  return { editor, editorRef, counts }
}
