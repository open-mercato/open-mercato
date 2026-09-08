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
import {
  firstSafeDocumentsDisplayLabel,
  sanitizeDocumentsDisplayLabel,
} from './displayLabels'
import {
  firstSafeCollaborationAwarenessName,
  normalizeCollaborationColor,
} from './collaborationAwareness'

export type EntityRefAttributes = {
  entityType: string
  entityId: string
  label: string
  href: string | null
  labelInvalid?: boolean
}

const DEFAULT_ENTITY_REF_FALLBACK_LABEL = 'Record'

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

function readEntityRefSnapshotLabel(element: HtmlLikeElement): string | null {
  if (element.getAttribute('data-entity-label-invalid') !== null) return null
  return firstSafeDocumentsDisplayLabel(
    readEntityRefAttribute(element, 'data-label'),
    element.textContent,
  )
}

export function isSafeEntityHref(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || !value.startsWith('/backend/')
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false
  }

  try {
    const base = new URL('https://open-mercato.invalid')
    const resolved = new URL(value, base)
    return resolved.origin === base.origin && resolved.pathname.startsWith('/backend/')
  } catch {
    return false
  }
}

type EntityRefPointerActivationEvent = {
  target: EventTarget | null
  metaKey: boolean
  ctrlKey: boolean
}

type EntityRefKeyboardActivationEvent = {
  target: EventTarget | null
  key: string
  preventDefault: () => void
}

type EntityHrefOpener = (href: string) => void

function readClosestEntityHref(target: EventTarget | null, selector: string): string | null {
  if (!target || typeof (target as { closest?: unknown }).closest !== 'function') return null
  const element = (target as unknown as { closest: (value: string) => unknown }).closest(selector)
  if (!element || typeof element !== 'object') return null
  const dataset = (element as { dataset?: { href?: unknown } }).dataset
  return isSafeEntityHref(dataset?.href) ? dataset.href : null
}

export function activateEntityRefFromPointerEvent(
  event: EntityRefPointerActivationEvent,
  openHref: EntityHrefOpener,
): boolean {
  if (!event.metaKey && !event.ctrlKey) return false
  const href = readClosestEntityHref(event.target, 'span[data-entity-ref]')
  if (!href) return false
  openHref(href)
  return true
}

export function activateEntityRefFromKeyboardEvent(
  event: EntityRefKeyboardActivationEvent,
  openHref: EntityHrefOpener,
): boolean {
  if (event.key !== 'Enter' && event.key !== ' ') return false
  const href = readClosestEntityHref(event.target, 'span[data-entity-ref][role="link"]')
  if (!href) return false
  event.preventDefault()
  openHref(href)
  return true
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

function createEntityRefNode(configuredFallbackLabel: string | null) {
  const fallbackLabel = sanitizeDocumentsDisplayLabel(configuredFallbackLabel)
  return Node.create({
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
            firstSafeDocumentsDisplayLabel(
              readEntityRefSnapshotLabel(element),
              fallbackLabel,
            ),
        },
        labelInvalid: {
          default: false,
          rendered: false,
          parseHTML: (element: HtmlLikeElement) => (
            element.getAttribute('data-entity-label-invalid') !== null
            || !readEntityRefSnapshotLabel(element)
          ),
        },
        href: {
          default: null,
          parseHTML: (element: HtmlLikeElement) => (
            readEntityRefSnapshotLabel(element)
              ? readEntityRefAttribute(element, 'data-href')
              : null
          ),
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
              label: firstSafeDocumentsDisplayLabel(
                readEntityRefSnapshotLabel(value),
                fallbackLabel,
              ),
              labelInvalid: value.getAttribute('data-entity-label-invalid') !== null
                || !readEntityRefSnapshotLabel(value),
              href: readEntityRefSnapshotLabel(value)
                ? readEntityRefAttribute(value, 'data-href')
                : null,
            }
          },
        },
      ]
    },
    renderHTML({ node }) {
      const attrs = node.attrs as Partial<EntityRefAttributes>
      const safeSnapshotLabel = attrs.labelInvalid
        ? null
        : sanitizeDocumentsDisplayLabel(attrs.label)
      const label = firstSafeDocumentsDisplayLabel(
        safeSnapshotLabel,
        fallbackLabel,
      ) ?? ''
      const href = safeSnapshotLabel && isSafeEntityHref(attrs.href) ? attrs.href : null
      const interactive = Boolean(label && href)
      return [
        'span',
        mergeAttributes({
          'data-entity-ref': '',
          'data-entity-type': attrs.entityType ?? undefined,
          'data-entity-id': attrs.entityId ?? undefined,
          'data-label': safeSnapshotLabel ?? undefined,
          'data-entity-label-invalid': safeSnapshotLabel ? undefined : '',
          'data-href': href ?? undefined,
          role: interactive ? 'link' : undefined,
          tabindex: interactive ? '0' : undefined,
          'aria-label': interactive ? label : undefined,
          class: 'om-entity-ref',
        }),
        label,
      ]
    },
  })
}

export const EntityRefNode = createEntityRefNode(DEFAULT_ENTITY_REF_FALLBACK_LABEL)

export const COLLAB_FRAGMENT_FIELD = 'default'

export function getDocumentEditorExtensions(options?: {
  history?: boolean
  entityRefFallbackLabel?: string
}) {
  const starterKit = StarterKit.configure({
    link: false,
    underline: false,
    ...(options?.history === false ? { undoRedo: false as const } : {}),
  })

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
    // Server-side CRDT materialization has no request locale. Preserve an
    // invalid marker and an empty snapshot there; every user-visible editor
    // supplies its localized fallback and renders it without persisting an
    // arbitrary English label into the shared document.
    createEntityRefNode(options?.entityRefFallbackLabel === undefined
      ? null
      : firstSafeDocumentsDisplayLabel(
        options.entityRefFallbackLabel,
        DEFAULT_ENTITY_REF_FALLBACK_LABEL,
      )),
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
  const color = normalizeCollaborationColor(user.color)
  return {
    style: `background-color: ${color}33`,
    class: 'ProseMirror-yjs-selection',
  }
}

export function resolveCollaborationCaretLabel(
  user: Record<string, unknown>,
  fallbackUserLabel: string,
): string {
  return firstSafeCollaborationAwarenessName(user.name, fallbackUserLabel)
}

export function resolveCollaborationCaretColor(user: Record<string, unknown>): string {
  return normalizeCollaborationColor(user.color)
}

export function renderCollaborationCaret(
  user: Record<string, unknown>,
  fallbackUserLabel: string,
): HTMLElement {
  const cursor = document.createElement('span')
  cursor.classList.add('collaboration-carets__caret')
  const color = resolveCollaborationCaretColor(user)
  cursor.setAttribute('style', `border-color: ${color}`)

  const labelText = resolveCollaborationCaretLabel(user, fallbackUserLabel)
  if (labelText) {
    cursor.setAttribute('role', 'img')
    cursor.setAttribute('aria-label', labelText)
    cursor.setAttribute('title', labelText)
    cursor.setAttribute('tabindex', '0')
    cursor.setAttribute('contenteditable', 'false')
    const label = document.createElement('div')
    label.classList.add('collaboration-carets__label')
    label.setAttribute('style', `background-color: ${color}`)
    label.setAttribute('aria-hidden', 'true')
    label.append(document.createTextNode(labelText))
    cursor.append(label)
  }
  return cursor
}

export function getCollaborativeEditorExtensions(args: {
  ydoc: import('yjs').Doc
  provider: unknown
  user: { name: string; color: string }
  placeholder?: string
  fallbackUserLabel: string
  fallbackEntityRefLabel: string
}) {
  return [
    ...getDocumentEditorExtensions({
      history: false,
      entityRefFallbackLabel: args.fallbackEntityRefLabel,
    }),
    Collaboration.configure({
      document: args.ydoc,
      field: COLLAB_FRAGMENT_FIELD,
    }),
    CollaborationCaret.configure({
      provider: args.provider,
      user: args.user,
      render: (user) => renderCollaborationCaret(user, args.fallbackUserLabel),
      selectionRender: collaboratorSelectionAttributes,
    }),
    Placeholder.configure({
      placeholder: args.placeholder ?? 'Start writing…',
    }),
  ]
}
