import { Mark, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'

const UnderlineMark = Mark.create({
  name: 'underline',
  parseHTML() {
    return [{ tag: 'u' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['u', mergeAttributes(HTMLAttributes), 0]
  },
})

export const COLLAB_FRAGMENT_FIELD = 'default'

export function getDocumentEditorExtensions(options?: { history?: boolean }) {
  const starterKit = options?.history === false
    ? StarterKit.configure({ undoRedo: false })
    : StarterKit

  return [
    starterKit,
    UnderlineMark,
    Link.configure({
      autolink: true,
      linkOnPaste: true,
      openOnClick: false,
    }),
    Image.configure({
      allowBase64: false,
      inline: false,
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
  ]
}

// Remote selections default to ~44% opacity (`${color}70`), which reads as a
// heavy solid block. Google Docs uses a light wash — drop it to ~20% (`33`) so
// overlapping text stays legible under a collaborator's highlight.
function collaboratorSelectionAttributes(user: { color: string }) {
  return {
    style: `background-color: ${user.color}33`,
    class: 'ProseMirror-yjs-selection',
  }
}

export function getCollaborativeEditorExtensions(args: {
  ydoc: import('yjs').Doc
  provider: unknown
  user: { name: string; color: string }
  placeholder?: string
}) {
  return [
    ...getDocumentEditorExtensions({ history: false }),
    Collaboration.configure({
      document: args.ydoc,
      field: COLLAB_FRAGMENT_FIELD,
    }),
    CollaborationCaret.configure({
      provider: args.provider,
      user: args.user,
      selectionRender: collaboratorSelectionAttributes,
    }),
    Placeholder.configure({
      placeholder: args.placeholder ?? 'Start writing…',
    }),
  ]
}
