import { Mark, mergeAttributes, Node, type AnyExtension } from '@tiptap/core'
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
import { TextAlign } from '@tiptap/extension-text-align'
import { Highlight } from '@tiptap/extension-highlight'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import { CharacterCount } from '@tiptap/extensions'

export type EntityRefAttributes = {
  entityType: string
  entityId: string
  label: string
  href: string | null
}

type HtmlLikeElement = {
  getAttribute: (name: string) => string | null
  textContent?: string | null
}

function isHtmlLikeElement(value: unknown): value is HtmlLikeElement {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { getAttribute?: unknown }).getAttribute === 'function',
  )
}

function readEntityRefAttribute(element: HtmlLikeElement, attribute: string): string | null {
  const value = element.getAttribute(attribute)
  return typeof value === 'string' && value.length > 0 ? value : null
}

const UnderlineMark = Mark.create({
  name: 'underline',
  parseHTML() {
    return [{ tag: 'u' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['u', mergeAttributes(HTMLAttributes), 0]
  },
})

export const EntityRefNode = Node.create({
  name: 'entityRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      entityType: {
        default: null,
        parseHTML: (element: HtmlLikeElement) => readEntityRefAttribute(element, 'data-entity-type'),
      },
      entityId: {
        default: null,
        parseHTML: (element: HtmlLikeElement) => readEntityRefAttribute(element, 'data-entity-id'),
      },
      label: {
        default: null,
        parseHTML: (element: HtmlLikeElement) =>
          readEntityRefAttribute(element, 'data-label') ?? element.textContent ?? null,
      },
      href: {
        default: null,
        parseHTML: (element: HtmlLikeElement) => readEntityRefAttribute(element, 'data-href'),
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-entity-ref]',
        getAttrs: (value: unknown) => {
          if (!isHtmlLikeElement(value)) return false
          return {
            entityType: readEntityRefAttribute(value, 'data-entity-type'),
            entityId: readEntityRefAttribute(value, 'data-entity-id'),
            label: readEntityRefAttribute(value, 'data-label') ?? value.textContent ?? null,
            href: readEntityRefAttribute(value, 'data-href'),
          }
        },
      },
    ]
  },
  renderHTML({ node }) {
    const attrs = node.attrs as Partial<EntityRefAttributes>
    return [
      'span',
      mergeAttributes({
        'data-entity-ref': '',
        'data-entity-type': attrs.entityType ?? undefined,
        'data-entity-id': attrs.entityId ?? undefined,
        'data-label': attrs.label ?? undefined,
        'data-href': attrs.href ?? undefined,
        class: 'om-entity-ref',
      }),
      attrs.label ?? '',
    ]
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
    EntityRefNode,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
  ]
}

export function getClientEditorExtras(): AnyExtension[] {
  return [
    CharacterCount.configure({}),
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
