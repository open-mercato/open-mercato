"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
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

function wordCount(editor: Editor | null): EditorWordCount {
  const storage = editor?.storage as Record<string, unknown> | undefined
  const candidate = storage?.characterCount as { words?: () => number; characters?: () => number } | undefined
  return { words: candidate?.words?.() ?? 0, characters: candidate?.characters?.() ?? 0 }
}

export function useDocumentEditor(input: UseDocumentEditorInput) {
  const t = useT()
  const editorRef = React.useRef<Editor | null>(null)
  const [counts, setCounts] = React.useState<EditorWordCount>({ words: 0, characters: 0 })

  const extensions = React.useMemo(() => {
    const suggestions = input.readOnly ? [] : [createEntitySuggestionExtension({
      onTrigger: ({ range }) => input.onEntitySuggestion(range),
      onClose: input.onSuggestionClose,
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
  }, [input.collabResources, input.editorMode, input.onEntitySuggestion, input.onSuggestionClose, input.readOnly, t])

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
    onCreate: ({ editor: created }) => { editorRef.current = created; setCounts(wordCount(created)); input.onEditorReady?.(created) },
    onDestroy: () => { editorRef.current = null; input.onEditorReady?.(null) },
    onUpdate: ({ editor: updated }) => {
      editorRef.current = updated
      setCounts(wordCount(updated))
      input.onUpdate?.(updated)
    },
  }, [input.documentId, input.editorMode, extensions])

  React.useEffect(() => { editorRef.current = editor; editor?.setEditable(!input.readOnly) }, [editor, input.readOnly])
  React.useEffect(() => () => { input.onEditorReady?.(null) }, [input.onEditorReady])
  return { editor, editorRef, counts }
}
