import type { Editor } from '@tiptap/core'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'
import { cn } from '@open-mercato/shared/lib/utils'
import type { CommentAnchor } from './CommentAnchorNavigation'

export type CollabTokenUser = { id: string; name: string; color: string }
export type CollabResources = { ydoc: Y.Doc; provider: HocuspocusProvider; user: CollabTokenUser }
export type PresenceUser = { key: string; name: string; color: string }
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'
export type EditorSelectionRange = { from: number; to: number }
export type EditorWordCount = { words: number; characters: number }
export type EditorMode = 'edit' | 'preview'

export type DocumentEditorIslandProps = {
  documentId: string
  title: string
  initialContentHtml: string
  contentUpdatedAt?: string | null
  documentUpdatedAt?: string | null
  readOnly: boolean
  onEditorReady?: (editor: Editor | null) => void
  onComment?: (anchor: CommentAnchor) => void
  onContentConflict?: () => void
  onTitleChange?: (title: string, updatedAt: string | null) => void
}

export type CollabState =
  | { mode: 'connecting' }
  | { mode: 'fallback'; readOnly: boolean }
  | { mode: 'collab'; resources: CollabResources; connectionStatus: ConnectionStatus; presenceUsers: PresenceUser[]; serverReadOnly: boolean }

export function resolveEditorMode(readOnly: boolean, serverReadOnly: boolean, requested: EditorMode): EditorMode {
  return readOnly || serverReadOnly ? 'preview' : requested
}

export function canCreateSelectionComment(input: {
  permissionReadOnly: boolean
  mode: EditorMode
  transport: 'collab' | 'fallback'
  hasCommentHandler: boolean
}): boolean {
  if (!input.hasCommentHandler || input.transport !== 'collab') return false
  const effectiveReadOnly = input.permissionReadOnly || input.mode === 'preview'
  return !effectiveReadOnly || input.permissionReadOnly
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

export function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

export const DOCUMENT_EDITOR_CONTENT_CLASS = cn(
  'max-w-none text-foreground',
  '[&_.ProseMirror]:min-h-96 [&_.ProseMirror]:focus-visible:outline-none',
  '[&_.ProseMirror>*:first-child]:mt-0 [&_.ProseMirror>*:last-child]:mb-0',
  '[&_h1]:mb-4 [&_h1]:mt-8 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:leading-tight',
  '[&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:leading-tight',
  '[&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-xl [&_h3]:font-semibold',
  '[&_p]:my-4 [&_p]:leading-7 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6',
  '[&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1',
  '[&_blockquote]:my-6 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic',
  '[&_pre]:my-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-sm',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4',
  '[&_img]:my-6 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md',
  '[&_table]:my-6 [&_table]:w-full [&_table]:border-collapse',
  '[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2',
  '[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:text-left',
)
