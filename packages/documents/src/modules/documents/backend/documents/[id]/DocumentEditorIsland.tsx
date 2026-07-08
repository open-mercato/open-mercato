"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { HocuspocusProvider } from '@hocuspocus/provider'
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Loader2,
  Pilcrow,
  Save,
  Strikethrough,
  Table2,
  Underline,
  Unlink,
} from 'lucide-react'
import * as Y from 'yjs'
import { getCollaborativeEditorExtensions, getDocumentEditorExtensions } from '../../../lib/editorConfig'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const COLLAB_CONNECTION_TIMEOUT_MS = 6000

type ContentResponse = {
  contentHtml?: string | null
  content_html?: string | null
  contentText?: string | null
  content_text?: string | null
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
  initialContentHtml: string
  initialUpdatedAt?: string | null
  readOnly: boolean
  onEditorReady?: (editor: Editor | null) => void
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

function ToolbarButton({ label, icon, active = false, disabled = false, onClick }: ToolbarButtonProps) {
  return (
    <IconButton
      type="button"
      variant={active ? 'outline' : 'ghost'}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </IconButton>
  )
}

function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  const t = useT()
  if (users.length === 0) return null
  return (
    <div className="flex items-center gap-2" aria-label={t('documents.editor.realtime.presenceLabel')}>
      <span className="text-xs text-muted-foreground">{t('documents.editor.realtime.presenceLabel')}</span>
      <div className="flex items-center gap-1">
        {users.map((user) => (
          <Avatar
            key={user.key}
            label={user.name}
            title={user.name}
            size="xs"
            className="border border-background text-primary-foreground"
            style={{ backgroundColor: user.color }}
          />
        ))}
      </div>
    </div>
  )
}

function DocumentEditorSurface({
  documentId,
  initialContentHtml,
  initialUpdatedAt,
  readOnly,
  onEditorReady,
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
  const [linkEditorOpen, setLinkEditorOpen] = React.useState(false)
  const [linkHref, setLinkHref] = React.useState('')
  const [isUploadingImage, setIsUploadingImage] = React.useState(false)

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
  const extensions = React.useMemo(() => {
    if (editorMode === 'collab' && collabResources) {
      return getCollaborativeEditorExtensions({
        ydoc: collabResources.ydoc,
        provider: collabResources.provider,
        user: { name: collabResources.user.name, color: collabResources.user.color },
      })
    }
    return getDocumentEditorExtensions()
  }, [collabResources, editorMode])

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
        class: 'min-h-96 rounded-b-lg px-4 py-4 text-sm focus-visible:outline-none',
      },
    },
    onCreate: ({ editor: createdEditor }) => {
      editorRef.current = createdEditor
      onEditorReady?.(createdEditor)
    },
    onDestroy: () => {
      editorRef.current = null
      onEditorReady?.(null)
    },
    onUpdate: ({ editor: updatedEditor }) => {
      editorRef.current = updatedEditor
      scheduleAutosave()
    },
  }, [documentId, editorMode, extensions, initialContentHtml])

  React.useEffect(() => {
    editorRef.current = editor
  }, [editor])

  React.useEffect(() => {
    updatedAtRef.current = initialUpdatedAt ?? null
  }, [initialUpdatedAt])

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

  const connectionLabel = React.useMemo(() => {
    if (editorMode === 'fallback') return t('documents.editor.realtime.offline')
    if (connectionStatus === 'connected') return t('documents.editor.realtime.connected')
    if (connectionStatus === 'offline') return t('documents.editor.realtime.offline')
    return t('documents.editor.realtime.connecting')
  }, [connectionStatus, editorMode, t])

  const isBusy = isUploadingImage
  const toolbarDisabled = effectiveReadOnly || !editor

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
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
          <div className="ml-auto flex items-center gap-2">
            <PresenceAvatars users={presenceUsers} />
            <span className="text-xs text-muted-foreground">{connectionLabel}</span>
            <Button
              type="button"
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
            className="flex flex-col gap-3 border-b border-border bg-muted/20 p-3 md:flex-row md:items-end"
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

        <EditorContent editor={editor} />
      </div>

      {editorMode === 'fallback' ? (
        <p className="rounded border border-status-info-border bg-status-info-bg px-3 py-2 text-sm text-status-info-text">
          {t('documents.editor.realtime.readOnlyFallback')}
        </p>
      ) : readOnly ? (
        <p className="rounded border border-status-info-border bg-status-info-bg px-3 py-2 text-sm text-status-info-text">
          {t('documents.editor.readOnly')}
        </p>
      ) : null}

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
  initialContentHtml,
  initialUpdatedAt,
  readOnly,
  onEditorReady,
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

      const updateConnectionStatus = (connectionStatus: ConnectionStatus) => {
        if (connectionStatus === 'connected') clearConnectionTimer()
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

      provider.on('status', handleStatus)
      provider.on('synced', handleSynced)
      provider.on('authenticationFailed', fallbackToReadOnly)
      provider.on('disconnect', fallbackToReadOnly)
      provider.on('close', fallbackToReadOnly)
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
        initialContentHtml={initialContentHtml}
        initialUpdatedAt={initialUpdatedAt}
        readOnly={readOnly}
        onEditorReady={onEditorReady}
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
      initialContentHtml={initialContentHtml}
      initialUpdatedAt={initialUpdatedAt}
      readOnly={readOnly}
      onEditorReady={onEditorReady}
      editorMode="collab"
      collabResources={collabState.resources}
      connectionStatus={collabState.connectionStatus}
      presenceUsers={collabState.presenceUsers}
    />
  )
}
