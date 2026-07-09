"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { HocuspocusProvider } from '@hocuspocus/provider'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Database,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Loader2,
  MessageSquare,
  Palette,
  PanelLeft,
  Pilcrow,
  Redo2,
  Save,
  Strikethrough,
  Table2,
  Underline,
  Unlink,
  Undo2,
  X,
} from 'lucide-react'
import * as Y from 'yjs'
import {
  getClientEditorExtras,
  getCollaborativeEditorExtensions,
  getDocumentEditorExtensions,
  type EntityRefAttributes,
} from '../../../lib/editorConfig'
import { createEntitySuggestionExtension, insertEntityRef } from '../../../lib/entitySuggestion'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { EntityPicker } from '../components/EntityPicker'
import { OutlinePane } from './OutlinePane'

const COLLAB_CONNECTION_TIMEOUT_MS = 6000
const TITLE_MAX_LENGTH = 512

const HIGHLIGHT_COLORS = [
  { value: '#fef08a', labelKey: 'documents.editor.colors.yellow' },
  { value: '#bbf7d0', labelKey: 'documents.editor.colors.green' },
  { value: '#bfdbfe', labelKey: 'documents.editor.colors.blue' },
  { value: '#e9d5ff', labelKey: 'documents.editor.colors.purple' },
  { value: '#fbcfe8', labelKey: 'documents.editor.colors.pink' },
  { value: '#fed7aa', labelKey: 'documents.editor.colors.orange' },
  { value: '#fecaca', labelKey: 'documents.editor.colors.red' },
  { value: '#e5e7eb', labelKey: 'documents.editor.colors.gray' },
] as const

const TEXT_COLORS = [
  { value: '#111827', labelKey: 'documents.editor.colors.black' },
  { value: '#dc2626', labelKey: 'documents.editor.colors.red' },
  { value: '#ea580c', labelKey: 'documents.editor.colors.orange' },
  { value: '#ca8a04', labelKey: 'documents.editor.colors.yellow' },
  { value: '#16a34a', labelKey: 'documents.editor.colors.green' },
  { value: '#2563eb', labelKey: 'documents.editor.colors.blue' },
  { value: '#7c3aed', labelKey: 'documents.editor.colors.purple' },
  { value: '#db2777', labelKey: 'documents.editor.colors.pink' },
] as const

type ContentResponse = {
  contentHtml?: string | null
  content_html?: string | null
  contentText?: string | null
  content_text?: string | null
  updatedAt?: string | null
  updated_at?: string | null
}

type DocumentMetadataUpdateResponse = {
  id?: string | null
  updatedAt?: string | null
  updated_at?: string | null
}

type AttachmentUploadResponse = {
  url?: string | null
  documentUrl?: string | null
  proxyUrl?: string | null
  attachmentId?: string | null
  attachment_id?: string | null
  id?: string | null
  item?: unknown
  attachment?: unknown
}

type CollabTokenUser = {
  id: string
  name: string
  color: string
}

type CollabTokenResponse = {
  token: string
  url: string | null
  documentId: string
  tier: string
  expiresInSec: number
  user: CollabTokenUser
}

type CollabResources = {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: CollabTokenUser
}

type PresenceUser = {
  key: string
  name: string
  color: string
}

type ConnectionStatus = 'connecting' | 'connected' | 'offline'

type EditorSelectionRange = {
  from: number
  to: number
}

type EditorWordCount = {
  words: number
  characters: number
}

type CharacterCountStorage = {
  words: () => number
  characters: () => number
}

type CollabState =
  | { mode: 'connecting' }
  | { mode: 'fallback' }
  | {
      mode: 'collab'
      resources: CollabResources
      connectionStatus: ConnectionStatus
      presenceUsers: PresenceUser[]
    }

type DocumentEditorIslandProps = {
  documentId: string
  title: string
  initialContentHtml: string
  initialUpdatedAt?: string | null
  documentUpdatedAt?: string | null
  readOnly: boolean
  onEditorReady?: (editor: Editor | null) => void
  onComment?: (selection: EditorSelectionRange) => void
  onTitleChange?: (title: string, updatedAt: string | null) => void
}

type DocumentEditorSurfaceProps = DocumentEditorIslandProps & {
  editorMode: 'collab' | 'fallback'
  collabResources?: CollabResources
  connectionStatus: ConnectionStatus
  presenceUsers: PresenceUser[]
}

type ToolbarButtonProps = {
  label: string
  icon: React.ReactNode
  active?: boolean
  disabled?: boolean
  size?: 'sm' | 'default'
  onMouseDown?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onClick: () => void
}

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

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function readUpdatedAt(payload: ContentResponse | null): string | null {
  if (!payload) return null
  return payload.updatedAt ?? payload.updated_at ?? null
}

function readDocumentUpdatedAt(payload: DocumentMetadataUpdateResponse | null): string | null {
  if (!payload) return null
  return payload.updatedAt ?? payload.updated_at ?? null
}

function readCharacterCountStorage(editor: Editor): CharacterCountStorage | null {
  const storage = editor.storage as unknown as Record<string, unknown>
  const candidate = storage.characterCount
  if (!candidate || typeof candidate !== 'object') return null
  const record = candidate as Record<string, unknown>
  if (typeof record.words !== 'function' || typeof record.characters !== 'function') return null
  return {
    words: record.words as () => number,
    characters: record.characters as () => number,
  }
}

function readEditorWordCount(editor: Editor | null): EditorWordCount {
  if (!editor) return { words: 0, characters: 0 }
  const characterCount = readCharacterCountStorage(editor)
  if (!characterCount) return { words: 0, characters: 0 }
  return {
    words: characterCount.words(),
    characters: characterCount.characters(),
  }
}

function findEntityRefElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const element = target.closest('span[data-entity-ref]')
  return element instanceof HTMLElement ? element : null
}

function createApiCallError(message: string, status: number, body: unknown): Error & { status: number; body: unknown } {
  return Object.assign(new Error(message), { status, body })
}

function readAttachmentUrl(documentId: string, payload: AttachmentUploadResponse | null): string | null {
  const root = readRecord(payload)
  if (!root) return null
  const nestedItem = readRecord(root.item)
  const nestedAttachment = readRecord(root.attachment)
  const candidates = [root, nestedItem, nestedAttachment].filter((value): value is Record<string, unknown> => value !== null)
  for (const record of candidates) {
    const url = readString(record, 'documentUrl', 'document_url', 'proxyUrl', 'proxy_url', 'url')
    if (url && url.includes(`/api/documents/${documentId}/attachments/`)) return url
  }
  for (const record of candidates) {
    const attachmentId = readString(record, 'attachmentId', 'attachment_id', 'id')
    if (attachmentId) return `/api/documents/${encodeURIComponent(documentId)}/attachments/${encodeURIComponent(attachmentId)}`
  }
  return null
}

function readCollabTokenResponse(payload: CollabTokenResponse | null): CollabTokenResponse | null {
  const root = readRecord(payload)
  if (!root) return null
  const user = readRecord(root.user)
  const token = readString(root, 'token')
  const documentId = readString(root, 'documentId', 'document_id')
  const tier = readString(root, 'tier')
  const expiresInSec = readNumber(root, 'expiresInSec', 'expires_in_sec')
  const userId = user ? readString(user, 'id') : null
  const userName = user ? readString(user, 'name') : null
  const userColor = user ? readString(user, 'color') : null
  if (!token || !documentId || !tier || !expiresInSec || !userId || !userName || !userColor) return null
  return {
    token,
    url: readString(root, 'url'),
    documentId,
    tier,
    expiresInSec,
    user: { id: userId, name: userName, color: userColor },
  }
}

function readPresenceUser(value: unknown): { name: string; color: string } | null {
  const record = readRecord(value)
  if (!record) return null
  const user = readRecord(record.user)
  if (!user) return null
  const name = readString(user, 'name')
  const color = readString(user, 'color')
  if (!name || !color) return null
  return { name, color }
}

function readPresenceUsers(provider: HocuspocusProvider): PresenceUser[] {
  const states = provider.awareness?.getStates() as Map<number, unknown> | undefined
  if (!states) return []
  const localClientId = provider.document.clientID
  const seen = new Set<string>()
  const users: PresenceUser[] = []
  states.forEach((state, clientId) => {
    if (clientId === localClientId) return
    const user = readPresenceUser(state)
    if (!user) return
    const key = `${user.name}:${user.color}`
    if (seen.has(key)) return
    seen.add(key)
    users.push({ key, name: user.name, color: user.color })
  })
  return users
}

function readConnectionStatus(payload: unknown): ConnectionStatus {
  const record = readRecord(payload)
  const status = record ? readString(record, 'status') : null
  if (status === 'connected') return 'connected'
  if (status === 'disconnected') return 'offline'
  return 'connecting'
}

function destroyCollabResources(resources: CollabResources): void {
  try {
    resources.provider.destroy()
  } finally {
    resources.ydoc.destroy()
  }
}

const CONNECTION_STATUS_STYLES: Record<ConnectionStatus, { pill: string; dot: string }> = {
  connected: {
    pill: 'border-status-success-border bg-status-success-bg text-status-success-text',
    dot: 'bg-status-success-icon',
  },
  connecting: {
    pill: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
    dot: 'bg-status-warning-icon',
  },
  offline: {
    pill: 'border-status-error-border bg-status-error-bg text-status-error-text',
    dot: 'bg-status-error-icon',
  },
}

const DOCUMENT_EDITOR_CONTENT_CLASS = cn(
  'max-w-none text-foreground',
  '[&_.ProseMirror]:min-h-96 [&_.ProseMirror]:focus-visible:outline-none',
  '[&_.ProseMirror>*:first-child]:mt-0 [&_.ProseMirror>*:last-child]:mb-0',
  '[&_h1]:mb-4 [&_h1]:mt-8 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:leading-tight',
  '[&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:leading-tight',
  '[&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:leading-snug',
  '[&_p]:my-4 [&_p]:leading-7',
  '[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6',
  '[&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6',
  '[&_li]:my-1 [&_li>p]:my-1',
  '[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0',
  '[&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li]:gap-2',
  '[&_ul[data-type=taskList]_label]:mt-1 [&_ul[data-type=taskList]_label]:shrink-0',
  '[&_blockquote]:my-6 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
  '[&_pre]:my-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:leading-6',
  '[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4',
  '[&_hr]:my-8 [&_hr]:border-border',
  '[&_img]:my-6 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md',
  '[&_table]:my-6 [&_table]:w-full [&_table]:border-collapse',
  '[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
  '[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold',
  '[&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left',
  '[&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-muted-foreground',
  '[&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
)

// Presence chrome for the yjs collaboration carets. The extension injects bare
// `collaboration-carets__caret` / `__label` nodes with only an inline color and
// no structural styling, so without this the caret is an invisible span and the
// name renders as a plain colored block. This turns them into a Google-Docs-like
// thin caret bar with a small name flag that pops in on movement and fades out
// (and stays on hover). Colors come from each collaborator's inline style, so
// only structure/animation lives here.
const COLLAB_PRESENCE_STYLE = `
.om-doc-collab .collaboration-carets__caret {
  position: relative;
  margin-left: -1px;
  margin-right: -1px;
  border-left-width: 2px;
  border-left-style: solid;
  border-right-width: 0;
  border-radius: 1px;
  box-sizing: border-box;
  word-break: normal;
  pointer-events: none;
}
.om-doc-collab .collaboration-carets__label {
  position: absolute;
  top: -1.55em;
  left: -2px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 6px;
  border-radius: 4px 4px 4px 1px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
  color: #ffffff;
  user-select: none;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(2, 6, 23, 0.28);
  opacity: 0;
  animation: om-doc-caret-flag 2.6s ease forwards;
}
.om-doc-collab .collaboration-carets__caret:hover .collaboration-carets__label {
  animation: none;
  opacity: 1;
}
.om-doc-collab .ProseMirror-yjs-selection {
  border-radius: 2px;
}
.ProseMirror .om-entity-ref {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  vertical-align: baseline;
  background: color-mix(in oklab, var(--primary) 12%, transparent);
  color: var(--primary);
  border: 1px solid color-mix(in oklab, var(--primary) 24%, transparent);
  border-radius: var(--radius-sm, 0.25rem);
  padding: 0 0.375em;
  font-weight: 500;
  line-height: 1.6;
  white-space: nowrap;
  cursor: default;
}
.ProseMirror .om-entity-ref:hover {
  background: color-mix(in oklab, var(--primary) 18%, transparent);
  border-color: color-mix(in oklab, var(--primary) 34%, transparent);
}
@keyframes om-doc-caret-flag {
  0% { opacity: 0; transform: translateY(3px); }
  8%, 52% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .om-doc-collab .collaboration-carets__label { animation: none; opacity: 1; }
}
`

function ToolbarGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-1', className)}>{children}</div>
}

function ToolbarDivider() {
  return <div className="hidden h-6 border-l border-border md:block" aria-hidden="true" />
}

function ToolbarButton({
  label,
  icon,
  active = false,
  disabled = false,
  size = 'default',
  onMouseDown,
  onClick,
}: ToolbarButtonProps) {
  return (
    <IconButton
      type="button"
      size={size}
      variant={active ? 'outline' : 'ghost'}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {icon}
    </IconButton>
  )
}

type SwatchButtonProps = {
  label: string
  color: string | null
  active?: boolean
  onClick: () => void
}

function SwatchButton({ label, color, active = false, onClick }: SwatchButtonProps) {
  return (
    <IconButton
      type="button"
      size="sm"
      variant={active ? 'outline' : 'ghost'}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {color ? (
        <span
          className="size-4 rounded-sm border border-border"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      ) : (
        <X className="size-4" aria-hidden="true" />
      )}
    </IconButton>
  )
}

function ConnectionStatusPill({ status, label }: { status: ConnectionStatus; label: string }) {
  const styles = CONNECTION_STATUS_STYLES[status]
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium', styles.pill)}>
      <span className={cn('size-2 rounded-full', styles.dot)} aria-hidden="true" />
      {label}
    </span>
  )
}

function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  const t = useT()
  if (users.length === 0) return null
  const visibleUsers = users.slice(0, 4)
  const hiddenCount = users.length - visibleUsers.length
  return (
    <div className="flex items-center" aria-label={t('documents.editor.realtime.presenceLabel')}>
      <div className="flex -space-x-2">
        {visibleUsers.map((user) => (
          <Avatar
            key={user.key}
            label={user.name}
            title={user.name}
            size="xs"
            className="border border-background text-primary-foreground ring-2 ring-background"
            style={{ backgroundColor: user.color }}
          />
        ))}
        {hiddenCount > 0 ? (
          <span
            className="inline-flex size-5 items-center justify-center rounded-full border border-background bg-muted text-xs font-semibold text-muted-foreground ring-2 ring-background"
            title={t('documents.editor.realtime.moreCollaborators', '{count} more collaborators', { count: hiddenCount })}
          >
            +{hiddenCount}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function DocumentEditorSurface({
  documentId,
  title,
  initialContentHtml,
  initialUpdatedAt,
  documentUpdatedAt,
  readOnly,
  onEditorReady,
  onComment,
  onTitleChange,
  editorMode,
  collabResources,
  connectionStatus,
  presenceUsers,
}: DocumentEditorSurfaceProps) {
  const t = useT()
  const linkInputId = React.useId()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const editorRef = React.useRef<Editor | null>(null)
  const saveTimerRef = React.useRef<number | null>(null)
  const updatedAtRef = React.useRef<string | null>(initialUpdatedAt ?? null)
  const entityPickerOpenRef = React.useRef(false)
  const committedTitleRef = React.useRef(title)
  const documentUpdatedAtRef = React.useRef<string | null>(documentUpdatedAt ?? null)
  const [linkEditorOpen, setLinkEditorOpen] = React.useState(false)
  const [linkHref, setLinkHref] = React.useState('')
  const [isUploadingImage, setIsUploadingImage] = React.useState(false)
  const [entityPickerOpen, setEntityPickerOpen] = React.useState(false)
  const [pendingSuggestionRange, setPendingSuggestionRange] = React.useState<EditorSelectionRange | null>(null)
  const [highlightPickerOpen, setHighlightPickerOpen] = React.useState(false)
  const [textColorPickerOpen, setTextColorPickerOpen] = React.useState(false)
  const [outlineOpen, setOutlineOpen] = React.useState(false)
  const [wordCount, setWordCount] = React.useState<EditorWordCount>({ words: 0, characters: 0 })
  const [titleValue, setTitleValue] = React.useState(title)
  const [isRenamingTitle, setIsRenamingTitle] = React.useState(false)

  const mutationContextId = `documents-editor:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked'),
  })

  const effectiveReadOnly = readOnly || editorMode === 'fallback'
  const handleEntitySuggestionTrigger = React.useCallback((ctx: { query: string; range: EditorSelectionRange }) => {
    setPendingSuggestionRange(ctx.range)
    entityPickerOpenRef.current = true
    setEntityPickerOpen(true)
  }, [])
  const handleEntitySuggestionClose = React.useCallback(() => {
    if (!entityPickerOpenRef.current) setPendingSuggestionRange(null)
  }, [])
  const extensions = React.useMemo(() => {
    const entitySuggestionExtensions = readOnly
      ? []
      : [createEntitySuggestionExtension({
        onTrigger: handleEntitySuggestionTrigger,
        onClose: handleEntitySuggestionClose,
      })]
    if (editorMode === 'collab' && collabResources) {
      return [
        ...getCollaborativeEditorExtensions({
          ydoc: collabResources.ydoc,
          provider: collabResources.provider,
          user: { name: collabResources.user.name, color: collabResources.user.color },
          placeholder: t('documents.editor.placeholder', 'Start writing…'),
        }),
        ...getClientEditorExtras(),
        ...entitySuggestionExtensions,
      ]
    }
    return [
      ...getDocumentEditorExtensions(),
      ...getClientEditorExtras(),
      ...entitySuggestionExtensions,
    ]
  }, [collabResources, editorMode, handleEntitySuggestionClose, handleEntitySuggestionTrigger, readOnly, t])

  const saveContent = React.useCallback(async () => {
    const editor = editorRef.current
    if (!editor || editorMode !== 'fallback' || effectiveReadOnly) return
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const contentHtml = editor.getHTML()
    const contentText = editor.getText()
    try {
      const call = await runMutation({
        operation: async () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(updatedAtRef.current),
            () => apiCallOrThrow<ContentResponse>(
              `/api/documents/${encodeURIComponent(documentId)}/content`,
              {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ contentHtml, contentText }),
              },
              { errorMessage: t('documents.editor.error.save') },
            ),
          ),
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_content',
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: { contentHtml, contentText },
      })
      updatedAtRef.current = readUpdatedAt(call.result) ?? updatedAtRef.current
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.editor.error.save'), 'error')
    }
  }, [documentId, effectiveReadOnly, editorMode, mutationContextId, retryLastMutation, runMutation, t])

  const scheduleAutosave = React.useCallback(() => {
    if (editorMode !== 'fallback' || effectiveReadOnly) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void saveContent()
    }, 1200)
  }, [editorMode, effectiveReadOnly, saveContent])

  const editor = useEditor({
    extensions,
    content: editorMode === 'fallback' ? initialContentHtml : undefined,
    editable: !effectiveReadOnly,
    editorProps: {
      attributes: {
        class: 'min-h-96 text-base leading-7 text-foreground focus-visible:outline-none',
      },
      handleClick(_view, _pos, event) {
        const entityRefElement = findEntityRefElement(event.target)
        if (!entityRefElement || (!event.metaKey && !event.ctrlKey)) return false
        const href = entityRefElement.dataset.href
        if (!href || !href.startsWith('/') || href.startsWith('//')) return false
        window.open(href, '_blank', 'noopener')
        return true
      },
    },
    onCreate: ({ editor: createdEditor }) => {
      editorRef.current = createdEditor
      setWordCount(readEditorWordCount(createdEditor))
      onEditorReady?.(createdEditor)
    },
    onDestroy: () => {
      editorRef.current = null
      setWordCount({ words: 0, characters: 0 })
      onEditorReady?.(null)
    },
    onUpdate: ({ editor: updatedEditor }) => {
      editorRef.current = updatedEditor
      setWordCount(readEditorWordCount(updatedEditor))
      scheduleAutosave()
    },
  }, [documentId, editorMode, extensions, initialContentHtml])

  React.useEffect(() => {
    editorRef.current = editor
    setWordCount(readEditorWordCount(editor))
  }, [editor])

  React.useEffect(() => {
    updatedAtRef.current = initialUpdatedAt ?? null
  }, [initialUpdatedAt])

  React.useEffect(() => {
    entityPickerOpenRef.current = entityPickerOpen
  }, [entityPickerOpen])

  React.useEffect(() => {
    committedTitleRef.current = title
    setTitleValue(title)
  }, [title])

  React.useEffect(() => {
    documentUpdatedAtRef.current = documentUpdatedAt ?? null
  }, [documentUpdatedAt])

  React.useEffect(() => {
    if (!editor) return
    editor.setEditable(!effectiveReadOnly)
  }, [editor, effectiveReadOnly])

  React.useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    onEditorReady?.(null)
  }, [onEditorReady])

  const runCommand = React.useCallback((command: (editor: Editor) => void) => {
    const currentEditor = editorRef.current
    if (!currentEditor || effectiveReadOnly) return
    command(currentEditor)
  }, [effectiveReadOnly])

  const openLinkEditor = React.useCallback(() => {
    const currentEditor = editorRef.current
    if (!currentEditor || effectiveReadOnly) return
    const attrs = currentEditor.getAttributes('link')
    const currentHref = typeof attrs.href === 'string' ? attrs.href : ''
    setLinkHref(currentHref)
    setLinkEditorOpen(true)
  }, [effectiveReadOnly])

  const applyLink = React.useCallback(() => {
    const currentEditor = editorRef.current
    if (!currentEditor || effectiveReadOnly) return
    const trimmed = linkHref.trim()
    if (trimmed.length === 0) {
      currentEditor.chain().focus().unsetLink().run()
    } else {
      currentEditor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
    }
    setLinkEditorOpen(false)
    scheduleAutosave()
  }, [effectiveReadOnly, linkHref, scheduleAutosave])

  const removeLink = React.useCallback(() => {
    const currentEditor = editorRef.current
    if (!currentEditor || effectiveReadOnly) return
    currentEditor.chain().focus().unsetLink().run()
    setLinkEditorOpen(false)
    scheduleAutosave()
  }, [effectiveReadOnly, scheduleAutosave])

  const handleCommentSelection = React.useCallback(() => {
    const currentEditor = editorRef.current
    if (!currentEditor || !onComment) return
    const { from, to } = currentEditor.state.selection
    if (from === to) return
    onComment({ from, to })
  }, [onComment])

  const handleImageFiles = React.useCallback(async (files: FileList | null) => {
    const file = files?.item(0)
    const currentEditor = editorRef.current
    if (!file || !currentEditor || effectiveReadOnly) return
    setIsUploadingImage(true)
    try {
      const formData = new FormData()
      formData.set('file', file)
      const call = await runMutation({
        operation: async () =>
          apiCallOrThrow<AttachmentUploadResponse>(
            `/api/documents/${encodeURIComponent(documentId)}/attachments`,
            { method: 'POST', body: formData },
            { errorMessage: t('documents.editor.error.imageUpload') },
          ),
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_attachment',
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: { fileName: file.name, fileType: file.type },
      })
      const url = readAttachmentUrl(documentId, call.result)
      if (!url) throw new Error(t('documents.editor.error.imageUpload'))
      currentEditor.chain().focus().setImage({ src: url }).run()
      scheduleAutosave()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.editor.error.imageUpload'), 'error')
    } finally {
      setIsUploadingImage(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [documentId, effectiveReadOnly, mutationContextId, retryLastMutation, runMutation, scheduleAutosave, t])

  const handleEntityPickerOpenChange = React.useCallback((open: boolean) => {
    entityPickerOpenRef.current = open
    setEntityPickerOpen(open)
    if (!open) setPendingSuggestionRange(null)
  }, [])

  const openEntityPicker = React.useCallback(() => {
    setPendingSuggestionRange(null)
    entityPickerOpenRef.current = true
    setEntityPickerOpen(true)
  }, [])

  const handleEntityPick = React.useCallback((pick: { type: string; id: string; label: string; href: string | null }) => {
    const currentEditor = editorRef.current
    if (!currentEditor || effectiveReadOnly) return
    const attrs: EntityRefAttributes = {
      entityType: pick.type,
      entityId: pick.id,
      label: pick.label,
      href: pick.href,
    }
    if (pendingSuggestionRange) {
      currentEditor.chain().focus().deleteRange(pendingSuggestionRange).run()
    }
    insertEntityRef(currentEditor, attrs)
    entityPickerOpenRef.current = false
    setEntityPickerOpen(false)
    setPendingSuggestionRange(null)
  }, [effectiveReadOnly, pendingSuggestionRange])

  const applyHighlight = React.useCallback((color: string) => {
    runCommand((currentEditor) => currentEditor.chain().focus().setHighlight({ color }).run())
    setHighlightPickerOpen(false)
  }, [runCommand])

  const clearHighlight = React.useCallback(() => {
    runCommand((currentEditor) => currentEditor.chain().focus().unsetHighlight().run())
    setHighlightPickerOpen(false)
  }, [runCommand])

  const applyTextColor = React.useCallback((color: string) => {
    runCommand((currentEditor) => currentEditor.chain().focus().setColor(color).run())
    setTextColorPickerOpen(false)
  }, [runCommand])

  const clearTextColor = React.useCallback(() => {
    runCommand((currentEditor) => currentEditor.chain().focus().unsetColor().run())
    setTextColorPickerOpen(false)
  }, [runCommand])

  const commitTitle = React.useCallback(async () => {
    if (readOnly || isRenamingTitle) return
    const nextTitle = titleValue.trim()
    const currentTitle = committedTitleRef.current
    if (nextTitle.length === 0 || nextTitle === currentTitle) {
      setTitleValue(currentTitle)
      return
    }

    setIsRenamingTitle(true)
    try {
      const call = await runMutation({
        operation: async () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(documentUpdatedAtRef.current),
            async () => {
              const result = await apiCall<DocumentMetadataUpdateResponse>(
                `/api/documents/${encodeURIComponent(documentId)}`,
                {
                  method: 'PUT',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ id: documentId, title: nextTitle }),
                },
              )
              if (!result.ok) {
                throw createApiCallError(t('documents.editor.error.rename'), result.status, result.result)
              }
              return result
            },
          ),
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document',
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: { id: documentId, title: nextTitle },
      })
      const nextUpdatedAt = readDocumentUpdatedAt(call.result) ?? documentUpdatedAtRef.current
      committedTitleRef.current = nextTitle
      documentUpdatedAtRef.current = nextUpdatedAt
      setTitleValue(nextTitle)
      onTitleChange?.(nextTitle, nextUpdatedAt)
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        flash(t('ui.forms.flash.recordModified'), 'error')
      } else {
        flash(err instanceof Error ? err.message : t('documents.editor.error.rename'), 'error')
      }
      setTitleValue(committedTitleRef.current)
    } finally {
      setIsRenamingTitle(false)
    }
  }, [
    documentId,
    isRenamingTitle,
    mutationContextId,
    onTitleChange,
    readOnly,
    retryLastMutation,
    runMutation,
    t,
    titleValue,
  ])

  const handleTitleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setTitleValue(committedTitleRef.current)
      event.currentTarget.blur()
    }
  }, [])

  const connectionLabel = React.useMemo(() => {
    if (editorMode === 'fallback') return t('documents.editor.realtime.offline')
    if (connectionStatus === 'connected') return t('documents.editor.realtime.connected')
    if (connectionStatus === 'offline') return t('documents.editor.realtime.offline')
    return t('documents.editor.realtime.connecting')
  }, [connectionStatus, editorMode, t])

  const isBusy = isUploadingImage
  const toolbarDisabled = effectiveReadOnly || !editor
  const resolvedConnectionStatus = editorMode === 'fallback' ? 'offline' : connectionStatus
  const shouldShowBubbleMenu = React.useCallback((selection: { from: number; to: number }) => {
    return selection.from !== selection.to && (!effectiveReadOnly || Boolean(onComment))
  }, [effectiveReadOnly, onComment])
  const keepBubbleSelectionOnMouseDown = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
  }, [])
  const readOnlyMessage = editorMode === 'fallback'
    ? t('documents.editor.realtime.readOnlyFallback')
    : readOnly
      ? t('documents.editor.readOnly')
      : null
  const activeTextColor = editor ? editor.getAttributes('textStyle').color : null
  const currentTextColor = typeof activeTextColor === 'string' ? activeTextColor : null
  const activeHighlightColor = editor ? editor.getAttributes('highlight').color : null
  const currentHighlightColor = typeof activeHighlightColor === 'string' ? activeHighlightColor : null

  return (
    <div className={cn('space-y-3', editorMode === 'collab' ? 'om-doc-collab' : null)}>
      <style dangerouslySetInnerHTML={{ __html: COLLAB_PRESENCE_STYLE }} />
      <div className="overflow-hidden rounded-lg border border-border bg-muted shadow-sm">
        <div className="sticky top-0 z-sticky border-b border-border bg-card/95">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <ToolbarGroup>
              <ToolbarButton
                label={t('documents.editor.toolbar.undo')}
                icon={<Undo2 />}
                disabled={toolbarDisabled || !(editor?.can().undo() ?? false)}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().undo().run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.redo')}
                icon={<Redo2 />}
                disabled={toolbarDisabled || !(editor?.can().redo() ?? false)}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().redo().run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.outline')}
                icon={<PanelLeft />}
                active={outlineOpen}
                disabled={!editor}
                onClick={() => setOutlineOpen((current) => !current)}
              />
            </ToolbarGroup>
            <ToolbarDivider />
            <ToolbarGroup>
              <ToolbarButton
                label={t('documents.editor.toolbar.paragraph')}
                icon={<Pilcrow />}
                active={editor?.isActive('paragraph') ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().setParagraph().run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.heading1')}
                icon={<Heading1 />}
                active={editor?.isActive('heading', { level: 1 }) ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleHeading({ level: 1 }).run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.heading2')}
                icon={<Heading2 />}
                active={editor?.isActive('heading', { level: 2 }) ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleHeading({ level: 2 }).run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.heading3')}
                icon={<Heading3 />}
                active={editor?.isActive('heading', { level: 3 }) ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleHeading({ level: 3 }).run())}
              />
            </ToolbarGroup>
            <ToolbarDivider />
            <ToolbarGroup>
              <ToolbarButton
                label={t('documents.editor.toolbar.alignLeft')}
                icon={<AlignLeft />}
                active={editor?.isActive({ textAlign: 'left' }) ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().setTextAlign('left').run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.alignCenter')}
                icon={<AlignCenter />}
                active={editor?.isActive({ textAlign: 'center' }) ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().setTextAlign('center').run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.alignRight')}
                icon={<AlignRight />}
                active={editor?.isActive({ textAlign: 'right' }) ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().setTextAlign('right').run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.alignJustify')}
                icon={<AlignJustify />}
                active={editor?.isActive({ textAlign: 'justify' }) ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().setTextAlign('justify').run())}
              />
            </ToolbarGroup>
            <ToolbarDivider />
            <ToolbarGroup>
              <ToolbarButton
                label={t('documents.editor.toolbar.bold')}
                icon={<Bold />}
                active={editor?.isActive('bold') ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleBold().run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.italic')}
                icon={<Italic />}
                active={editor?.isActive('italic') ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleItalic().run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.underline')}
                icon={<Underline />}
                active={editor?.isActive('underline') ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleMark('underline').run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.strike')}
                icon={<Strikethrough />}
                active={editor?.isActive('strike') ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleStrike().run())}
              />
              <div className="relative">
                <ToolbarButton
                  label={t('documents.editor.toolbar.highlight')}
                  icon={<Highlighter />}
                  active={currentHighlightColor !== null}
                  disabled={toolbarDisabled}
                  onClick={() => {
                    setHighlightPickerOpen((current) => !current)
                    setTextColorPickerOpen(false)
                  }}
                />
                {highlightPickerOpen ? (
                  <div
                    className="absolute left-0 top-full z-popover mt-2 flex items-center gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setHighlightPickerOpen(false)
                    }}
                  >
                    <SwatchButton
                      label={t('documents.editor.toolbar.highlightNone')}
                      color={null}
                      active={currentHighlightColor === null}
                      onClick={clearHighlight}
                    />
                    {HIGHLIGHT_COLORS.map((option) => (
                      <SwatchButton
                        key={option.value}
                        label={t('documents.editor.toolbar.highlightColor', { color: t(option.labelKey) })}
                        color={option.value}
                        active={currentHighlightColor?.toLowerCase() === option.value}
                        onClick={() => applyHighlight(option.value)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="relative">
                <ToolbarButton
                  label={t('documents.editor.toolbar.textColor')}
                  icon={<Palette />}
                  active={currentTextColor !== null}
                  disabled={toolbarDisabled}
                  onClick={() => {
                    setTextColorPickerOpen((current) => !current)
                    setHighlightPickerOpen(false)
                  }}
                />
                {textColorPickerOpen ? (
                  <div
                    className="absolute left-0 top-full z-popover mt-2 flex items-center gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setTextColorPickerOpen(false)
                    }}
                  >
                    <SwatchButton
                      label={t('documents.editor.toolbar.textColorDefault')}
                      color={null}
                      active={currentTextColor === null}
                      onClick={clearTextColor}
                    />
                    {TEXT_COLORS.map((option) => (
                      <SwatchButton
                        key={option.value}
                        label={t('documents.editor.toolbar.textColorValue', { color: t(option.labelKey) })}
                        color={option.value}
                        active={currentTextColor?.toLowerCase() === option.value}
                        onClick={() => applyTextColor(option.value)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </ToolbarGroup>
            <ToolbarDivider />
            <ToolbarGroup>
              <ToolbarButton
                label={t('documents.editor.toolbar.bulletList')}
                icon={<List />}
                active={editor?.isActive('bulletList') ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleBulletList().run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.orderedList')}
                icon={<ListOrdered />}
                active={editor?.isActive('orderedList') ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleOrderedList().run())}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.taskList')}
                icon={<ListTodo />}
                active={editor?.isActive('taskList') ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleTaskList().run())}
              />
            </ToolbarGroup>
            <ToolbarDivider />
            <ToolbarGroup>
              <ToolbarButton
                label={t('documents.editor.toolbar.table')}
                icon={<Table2 />}
                disabled={toolbarDisabled}
                onClick={() =>
                  runCommand((currentEditor) =>
                    currentEditor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
                  )
                }
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.insertRecord')}
                icon={<Database />}
                disabled={toolbarDisabled}
                onClick={openEntityPicker}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.link')}
                icon={<Link2 />}
                active={editor?.isActive('link') ?? false}
                disabled={toolbarDisabled}
                onClick={openLinkEditor}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.image')}
                icon={isUploadingImage ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                disabled={toolbarDisabled || isUploadingImage}
                onClick={() => fileInputRef.current?.click()}
              />
              <ToolbarButton
                label={t('documents.editor.toolbar.codeBlock')}
                icon={<Code2 />}
                active={editor?.isActive('codeBlock') ?? false}
                disabled={toolbarDisabled}
                onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleCodeBlock().run())}
              />
            </ToolbarGroup>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <PresenceAvatars users={presenceUsers} />
              <span className="text-xs text-muted-foreground">
                {t('documents.editor.wordCount', { words: wordCount.words, characters: wordCount.characters })}
              </span>
              <ConnectionStatusPill status={resolvedConnectionStatus} label={connectionLabel} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void saveContent()}
                disabled={editorMode === 'collab' || effectiveReadOnly || !editor || isBusy}
              >
                <Save />
                {t('documents.actions.save')}
              </Button>
            </div>
          </div>

          {linkEditorOpen ? (
            <div
              className="flex flex-col gap-3 border-t border-border bg-muted/30 p-3 md:flex-row md:items-end"
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  applyLink()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setLinkEditorOpen(false)
                }
              }}
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor={linkInputId}>{t('documents.editor.link.url')}</Label>
                <Input
                  id={linkInputId}
                  type="url"
                  value={linkHref}
                  onChange={(event) => setLinkHref(event.target.value)}
                  placeholder={t('documents.editor.link.placeholder')}
                  disabled={effectiveReadOnly}
                />
              </div>
              <Button type="button" onClick={applyLink} disabled={effectiveReadOnly}>
                <Link2 />
                {t('documents.editor.link.apply')}
              </Button>
              <Button type="button" variant="outline" onClick={removeLink} disabled={effectiveReadOnly}>
                <Unlink />
                {t('documents.editor.link.remove')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setLinkEditorOpen(false)}>
                {t('documents.actions.cancel')}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="bg-muted px-4 py-8 md:px-8 md:py-10">
          {readOnlyMessage ? (
            <p className="mx-auto mb-4 max-w-3xl rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-sm text-status-info-text">
              {readOnlyMessage}
            </p>
          ) : null}
          <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:flex-row lg:items-start">
            {outlineOpen ? <OutlinePane editor={editor} /> : null}
            <article className="mx-auto min-h-96 max-w-3xl flex-1 rounded-lg bg-card px-6 py-8 shadow-lg md:px-12 md:py-16">
              {readOnly ? (
                <h1 className="mb-8 text-3xl font-semibold leading-tight text-foreground">{titleValue}</h1>
              ) : (
                <Input
                  value={titleValue}
                  onChange={(event) => setTitleValue(event.target.value)}
                  onBlur={() => void commitTitle()}
                  onKeyDown={handleTitleKeyDown}
                  maxLength={TITLE_MAX_LENGTH}
                  disabled={isRenamingTitle}
                  aria-label={t('documents.editor.title.ariaLabel')}
                  className="mb-8 h-auto border-0 bg-transparent px-0 py-0 text-3xl font-semibold leading-tight text-foreground shadow-none focus-visible:shadow-focus"
                />
              )}
              {editor ? (
                <BubbleMenu
                  editor={editor}
                  shouldShow={shouldShowBubbleMenu}
                  className="z-popover flex items-center gap-1 rounded-md border border-border bg-card p-1 shadow-md"
                >
                  <ToolbarButton
                    size="sm"
                    label={t('documents.editor.toolbar.bold')}
                    icon={<Bold />}
                    active={editor.isActive('bold')}
                    disabled={effectiveReadOnly}
                    onMouseDown={keepBubbleSelectionOnMouseDown}
                    onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleBold().run())}
                  />
                  <ToolbarButton
                    size="sm"
                    label={t('documents.editor.toolbar.italic')}
                    icon={<Italic />}
                    active={editor.isActive('italic')}
                    disabled={effectiveReadOnly}
                    onMouseDown={keepBubbleSelectionOnMouseDown}
                    onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleItalic().run())}
                  />
                  <ToolbarButton
                    size="sm"
                    label={t('documents.editor.toolbar.underline')}
                    icon={<Underline />}
                    active={editor.isActive('underline')}
                    disabled={effectiveReadOnly}
                    onMouseDown={keepBubbleSelectionOnMouseDown}
                    onClick={() => runCommand((currentEditor) => currentEditor.chain().focus().toggleMark('underline').run())}
                  />
                  <ToolbarButton
                    size="sm"
                    label={t('documents.editor.toolbar.link')}
                    icon={<Link2 />}
                    active={editor.isActive('link')}
                    disabled={effectiveReadOnly}
                    onMouseDown={keepBubbleSelectionOnMouseDown}
                    onClick={openLinkEditor}
                  />
                  {onComment ? (
                    <>
                      <ToolbarDivider />
                      <Button
                        type="button"
                        size="2xs"
                        variant="ghost"
                        onMouseDown={keepBubbleSelectionOnMouseDown}
                        onClick={handleCommentSelection}
                      >
                        <MessageSquare />
                        {t('documents.editor.toolbar.comment', 'Comment')}
                      </Button>
                    </>
                  ) : null}
                </BubbleMenu>
              ) : null}
              <EditorContent className={DOCUMENT_EDITOR_CONTENT_CLASS} editor={editor} />
            </article>
          </div>
        </div>
      </div>

      <EntityPicker
        open={entityPickerOpen}
        onOpenChange={handleEntityPickerOpenChange}
        onPick={handleEntityPick}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={t('documents.editor.imageInput')}
        onChange={(event) => void handleImageFiles(event.target.files)}
      />
    </div>
  )
}

export default function DocumentEditorIsland({
  documentId,
  title,
  initialContentHtml,
  initialUpdatedAt,
  documentUpdatedAt,
  readOnly,
  onEditorReady,
  onComment,
  onTitleChange,
}: DocumentEditorIslandProps) {
  const t = useT()
  const resourcesRef = React.useRef<CollabResources | null>(null)
  const [collabState, setCollabState] = React.useState<CollabState>({ mode: 'connecting' })

  React.useEffect(() => {
    let cancelled = false
    let localResources: CollabResources | null = null
    let connectionTimer: number | null = null

    const clearConnectionTimer = () => {
      if (connectionTimer !== null) {
        window.clearTimeout(connectionTimer)
        connectionTimer = null
      }
    }

    const fallbackToReadOnly = () => {
      if (cancelled) return
      clearConnectionTimer()
      if (localResources && resourcesRef.current === localResources) {
        resourcesRef.current = null
        destroyCollabResources(localResources)
      }
      localResources = null
      setCollabState({ mode: 'fallback' })
    }

    async function refreshToken(): Promise<string> {
      const tokenCall = await apiCall<CollabTokenResponse>(
        `/api/documents/${encodeURIComponent(documentId)}/collab-token`,
      )
      const tokenResult = tokenCall.ok ? readCollabTokenResponse(tokenCall.result) : null
      return tokenResult?.token ?? ''
    }

    async function startCollaboration() {
      setCollabState({ mode: 'connecting' })
      const tokenCall = await apiCall<CollabTokenResponse>(
        `/api/documents/${encodeURIComponent(documentId)}/collab-token`,
      )
      if (cancelled) return
      const tokenResult = tokenCall.ok ? readCollabTokenResponse(tokenCall.result) : null
      if (!tokenResult?.url) {
        fallbackToReadOnly()
        return
      }

      const ydoc = new Y.Doc()
      let initialToken: string | null = tokenResult.token
      const provider = new HocuspocusProvider({
        url: tokenResult.url,
        name: documentId,
        document: ydoc,
        token: async () => {
          if (initialToken) {
            const token = initialToken
            initialToken = null
            return token
          }
          return refreshToken()
        },
      })
      const resources: CollabResources = { ydoc, provider, user: tokenResult.user }
      localResources = resources
      resourcesRef.current = resources

      const updatePresence = () => {
        if (cancelled || resourcesRef.current !== resources) return
        const presenceUsers = readPresenceUsers(provider)
        setCollabState((current) => (
          current.mode === 'collab' && current.resources === resources
            ? { ...current, presenceUsers }
            : current
        ))
      }

      let hasConnected = false
      const updateConnectionStatus = (connectionStatus: ConnectionStatus) => {
        if (connectionStatus === 'connected') {
          hasConnected = true
          clearConnectionTimer()
        }
        if (cancelled || resourcesRef.current !== resources) return
        setCollabState((current) => (
          current.mode === 'collab' && current.resources === resources
            ? { ...current, connectionStatus }
            : current
        ))
      }

      const handleStatus = (payload: unknown) => updateConnectionStatus(readConnectionStatus(payload))
      const handleSynced = (payload: unknown) => {
        const record = readRecord(payload)
        if (record?.state === true) updateConnectionStatus('connected')
      }

      // A mid-session disconnect/close (e.g. the sidecar force-closing the room after a
      // share/downgrade/restore) must NOT tear the editor down: HocuspocusProvider
      // auto-reconnects and re-mints a fresh token (picking up the caller's current
      // tier). Only fall back to read-only when we never connected in the first place;
      // a genuine loss of access surfaces separately as `authenticationFailed`.
      const handleDisconnect = () => {
        if (cancelled) return
        if (!hasConnected) {
          fallbackToReadOnly()
          return
        }
        updateConnectionStatus('offline')
      }

      provider.on('status', handleStatus)
      provider.on('synced', handleSynced)
      provider.on('authenticationFailed', fallbackToReadOnly)
      provider.on('disconnect', handleDisconnect)
      provider.on('close', handleDisconnect)
      provider.awareness?.on('change', updatePresence)

      connectionTimer = window.setTimeout(fallbackToReadOnly, COLLAB_CONNECTION_TIMEOUT_MS)
      setCollabState({
        mode: 'collab',
        resources,
        connectionStatus: 'connecting',
        presenceUsers: readPresenceUsers(provider),
      })
    }

    void startCollaboration().catch(() => {
      fallbackToReadOnly()
    })

    return () => {
      cancelled = true
      clearConnectionTimer()
      if (localResources) {
        destroyCollabResources(localResources)
      }
      if (resourcesRef.current === localResources) resourcesRef.current = null
    }
  }, [documentId])

  React.useEffect(() => () => {
    onEditorReady?.(null)
  }, [onEditorReady])

  if (collabState.mode === 'connecting') {
    return <LoadingMessage label={t('documents.editor.loading')} />
  }

  if (collabState.mode === 'fallback') {
    return (
      <DocumentEditorSurface
        key={`fallback:${documentId}`}
        documentId={documentId}
        title={title}
        initialContentHtml={initialContentHtml}
        initialUpdatedAt={initialUpdatedAt}
        documentUpdatedAt={documentUpdatedAt}
        readOnly={readOnly}
        onEditorReady={onEditorReady}
        onComment={onComment}
        onTitleChange={onTitleChange}
        editorMode="fallback"
        connectionStatus="offline"
        presenceUsers={[]}
      />
    )
  }

  return (
    <DocumentEditorSurface
      key={`collab:${documentId}`}
      documentId={documentId}
      title={title}
      initialContentHtml={initialContentHtml}
      initialUpdatedAt={initialUpdatedAt}
      documentUpdatedAt={documentUpdatedAt}
      readOnly={readOnly}
      onEditorReady={onEditorReady}
      onComment={onComment}
      onTitleChange={onTitleChange}
      editorMode="collab"
      collabResources={collabState.resources}
      connectionStatus={collabState.connectionStatus}
      presenceUsers={collabState.presenceUsers}
    />
  )
}
