"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { AtSign, CheckCircle2, CornerDownRight, MessageSquare, RotateCcw, Send } from 'lucide-react'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MentionPicker } from './MentionPicker'

export type DocumentTier = 'owner' | 'editor' | 'commenter' | 'viewer'

type CommentAnchor = {
  from: number
  to: number
}

type CommentFocusRequest = {
  anchor: CommentAnchor
  requestId: number
}

type DocumentComment = {
  id: string
  documentId: string
  parentCommentId: string | null
  authorUserId: string
  body: string
  anchor: CommentAnchor | null
  resolvedAt: string | null
  resolvedByUserId: string | null
  createdAt: string
  updatedAt: string
  replies: DocumentComment[]
}

type CommentsRailProps = {
  documentId: string
  tier: DocumentTier
  editor: Editor | null
  commentFocusRequest?: CommentFocusRequest | null
  canShare?: boolean
}

type CommentsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; comments: DocumentComment[] }

type GrantAccessChoice = 'share' | 'skip'

type GrantAccessPromptState = {
  names: string[]
}

type Translate = (key: string, fallback?: string) => string

type CommentItemProps = {
  comment: DocumentComment
  canComment: boolean
  canResolve: boolean
  isResolving: boolean
  onJump: (comment: DocumentComment) => void
  onReply: (comment: DocumentComment) => void
  onResolve: (comment: DocumentComment) => void
  t: Translate
}

const MENTION_TOKEN_PATTERN =
  /@\[([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]/gi

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

function readNullableString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (value === null) return null
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

function readAnchor(value: unknown): CommentAnchor | null {
  const record = readRecord(value)
  if (!record) return null
  const from = readNumber(record, 'from')
  const to = readNumber(record, 'to')
  if (from === null || to === null || from === to) return null
  return { from, to }
}

function normalizeComment(value: unknown): DocumentComment | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const documentId = readString(record, 'documentId', 'document_id')
  const authorUserId = readString(record, 'authorUserId', 'author_user_id')
  const body = readString(record, 'body') ?? ''
  const createdAt = readString(record, 'createdAt', 'created_at')
  const updatedAt = readString(record, 'updatedAt', 'updated_at')
  if (!id || !documentId || !authorUserId || !createdAt || !updatedAt) return null
  const rawReplies = record.replies
  const replies = Array.isArray(rawReplies)
    ? rawReplies.map(normalizeComment).filter((comment): comment is DocumentComment => comment !== null)
    : []
  return {
    id,
    documentId,
    parentCommentId: readNullableString(record, 'parentCommentId', 'parent_comment_id'),
    authorUserId,
    body,
    anchor: readAnchor(record.anchor),
    resolvedAt: readNullableString(record, 'resolvedAt', 'resolved_at'),
    resolvedByUserId: readNullableString(record, 'resolvedByUserId', 'resolved_by_user_id'),
    createdAt,
    updatedAt,
    replies,
  }
}

function readCommentItems(payload: unknown): DocumentComment[] {
  if (Array.isArray(payload)) return payload.map(normalizeComment).filter((comment): comment is DocumentComment => comment !== null)
  const record = readRecord(payload)
  if (!record) return []
  const candidates = [record.items, record.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(normalizeComment).filter((comment): comment is DocumentComment => comment !== null)
    }
  }
  return []
}

function canCommentWithTier(tier: DocumentTier): boolean {
  return tier === 'commenter' || tier === 'editor' || tier === 'owner'
}

function canResolveWithTier(tier: DocumentTier): boolean {
  return canCommentWithTier(tier)
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

function shortenId(value: string): string {
  return value.length > 12 ? value.slice(0, 8) : value
}

function extractMentionedUserIds(body: string): string[] {
  return Array.from(
    new Set(
      Array.from(body.matchAll(MENTION_TOKEN_PATTERN))
        .map((match) => match[1])
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => value.toLowerCase()),
    ),
  )
}

function extractMentionNames(body: string): Map<string, string> {
  const names = new Map<string, string>()
  for (const match of body.matchAll(MENTION_TOKEN_PATTERN)) {
    const userId = match[1]
    if (!userId) continue
    const beforeToken = body.slice(0, match.index ?? 0)
    const nameMatch = beforeToken.match(/@([^@\n]{1,120})\s*$/)
    const name = nameMatch?.[1]?.trim()
    if (name) names.set(userId.toLowerCase(), name)
  }
  return names
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.toLowerCase())
}

function readAccessCheckWithoutAccess(payload: unknown): string[] {
  const record = readRecord(payload)
  if (!record) return []
  return readStringArray(record.withoutAccess)
}

function formatCommentBody(body: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let tokenIndex = 0
  for (const match of body.matchAll(MENTION_TOKEN_PATTERN)) {
    const matchIndex = match.index ?? 0
    const token = match[0]
    const userId = match[1] ?? ''
    const between = body.slice(lastIndex, matchIndex)
    const readablePrefix = between.match(/@([^\s]+)\s$/)
    const label = readablePrefix?.[1] ?? shortenId(userId)
    const literalBefore = readablePrefix ? between.slice(0, readablePrefix.index) : between
    if (literalBefore.length > 0) {
      parts.push(literalBefore)
    }
    parts.push(
      <span
        key={`${userId}:${tokenIndex}`}
        className="inline-flex rounded-full bg-muted px-2 py-1 text-xs font-medium text-primary"
      >
        @{label}
      </span>,
    )
    lastIndex = matchIndex + token.length
    tokenIndex += 1
  }
  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex))
  }
  return parts.length > 0 ? parts : [body]
}

function CommentItem({
  comment,
  canComment,
  canResolve,
  isResolving,
  onJump,
  onReply,
  onResolve,
  t,
}: CommentItemProps) {
  const hasAnchor = comment.anchor !== null
  const resolved = comment.resolvedAt !== null
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{shortenId(comment.authorUserId)}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</p>
        </div>
        {resolved ? (
          <StatusBadge variant="success" dot>
            {t('documents.comments.resolved')}
          </StatusBadge>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground">{formatCommentBody(comment.body)}</p>
    </>
  )

  return (
    <article className="space-y-3 rounded-lg border border-border bg-background p-3">
      {hasAnchor ? (
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full flex-col items-stretch justify-start gap-2 p-0 text-left hover:bg-transparent"
          onClick={() => onJump(comment)}
        >
          {content}
        </Button>
      ) : (
        <div className="space-y-2">{content}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canComment && comment.parentCommentId === null ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onReply(comment)}>
            <CornerDownRight />
            {t('documents.comments.actions.reply')}
          </Button>
        ) : null}
        {canResolve ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onResolve(comment)}
            disabled={isResolving}
          >
            {resolved ? <RotateCcw /> : <CheckCircle2 />}
            {resolved ? t('documents.comments.actions.reopen') : t('documents.comments.actions.resolve')}
          </Button>
        ) : null}
      </div>
      {comment.replies.length > 0 ? (
        <div className="space-y-2 border-l border-border pl-3">
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              canComment={false}
              canResolve={canResolve}
              isResolving={isResolving}
              onJump={onJump}
              onReply={onReply}
              onResolve={onResolve}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function CommentsRail({ documentId, tier, editor, commentFocusRequest, canShare = false }: CommentsRailProps) {
  const t = useT()
  const composerId = React.useId()
  const composerRef = React.useRef<HTMLFormElement | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const grantAccessResolverRef = React.useRef<((choice: GrantAccessChoice) => void) | null>(null)
  const [state, setState] = React.useState<CommentsState>({ status: 'loading' })
  const [body, setBody] = React.useState('')
  const [mentionedUsers, setMentionedUsers] = React.useState<Map<string, string>>(() => new Map())
  const [parentCommentId, setParentCommentId] = React.useState<string | null>(null)
  const [pendingAnchor, setPendingAnchor] = React.useState<CommentAnchor | null>(null)
  const [mentionPickerOpen, setMentionPickerOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [resolvingCommentId, setResolvingCommentId] = React.useState<string | null>(null)
  const [grantAccessPrompt, setGrantAccessPrompt] = React.useState<GrantAccessPromptState | null>(null)

  const mutationContextId = `documents-comments:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked'),
  })

  const reload = React.useCallback(async () => {
    setState((current) => current.status === 'ready' ? current : { status: 'loading' })
    try {
      const call = await apiCall<unknown>(`/api/documents/${encodeURIComponent(documentId)}/comments`)
      if (!call.ok) {
        setState({ status: 'error', message: t('documents.comments.error.load') })
        return
      }
      setState({ status: 'ready', comments: readCommentItems(call.result) })
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : t('documents.comments.error.load') })
    }
  }, [documentId, t])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const canComment = canCommentWithTier(tier)
  const canResolve = canResolveWithTier(tier)

  React.useEffect(() => {
    if (!commentFocusRequest || !canComment) return
    setParentCommentId(null)
    setPendingAnchor(commentFocusRequest.anchor)
    window.setTimeout(() => {
      composerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      textareaRef.current?.focus()
    }, 0)
  }, [canComment, commentFocusRequest])

  React.useEffect(() => () => {
    grantAccessResolverRef.current?.('skip')
    grantAccessResolverRef.current = null
  }, [])

  const resolveGrantAccessPrompt = React.useCallback((choice: GrantAccessChoice) => {
    const resolver = grantAccessResolverRef.current
    grantAccessResolverRef.current = null
    setGrantAccessPrompt(null)
    resolver?.(choice)
  }, [])

  const grantPromptKeyDown = useDialogKeyHandler({
    onConfirm: () => resolveGrantAccessPrompt('share'),
    onCancel: () => resolveGrantAccessPrompt('skip'),
  })

  const requestGrantAccessChoice = React.useCallback((names: string[]): Promise<GrantAccessChoice> => {
    grantAccessResolverRef.current?.('skip')
    return new Promise((resolve) => {
      grantAccessResolverRef.current = resolve
      setGrantAccessPrompt({ names })
    })
  }, [])

  const captureSelectionAnchor = React.useCallback((): CommentAnchor | null => {
    if (!editor) return null
    const { from, to } = editor.state.selection
    if (from === to) return null
    const docSize = editor.state.doc.content.size
    if (from < 0 || to < 0 || from > docSize || to > docSize || from >= to) return null
    return { from, to }
  }, [editor])

  const handleBodyChange = React.useCallback((nextBody: string) => {
    setBody(nextBody)
    const namesFromBody = extractMentionNames(nextBody)
    if (namesFromBody.size === 0) return
    setMentionedUsers((current) => {
      const next = new Map(current)
      for (const [id, name] of namesFromBody) {
        next.set(id, name)
      }
      return next
    })
  }, [])

  const checkMentionAccess = React.useCallback(async (userIds: string[]): Promise<string[]> => {
    const call = await apiCall<unknown>(
      `/api/documents/${encodeURIComponent(documentId)}/comments/access-check`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userIds }),
      },
    )
    if (!call.ok) throw new Error(t('documents.comments.error.save'))
    return readAccessCheckWithoutAccess(call.result)
  }, [documentId, t])

  const resolveGrantAccessTo = React.useCallback(async (trimmedBody: string): Promise<string[] | undefined> => {
    const mentionedIds = extractMentionedUserIds(trimmedBody)
    if (mentionedIds.length === 0) return undefined

    const withoutAccess = await checkMentionAccess(mentionedIds)
    if (withoutAccess.length === 0) return undefined
    if (!canShare) {
      flash(t('documents.comments.grant.noAccessInfo'), 'info')
      return []
    }

    const namesFromBody = extractMentionNames(trimmedBody)
    const names = withoutAccess.map((userId) =>
      mentionedUsers.get(userId) ?? namesFromBody.get(userId) ?? shortenId(userId),
    )
    const choice = await requestGrantAccessChoice(names)
    return choice === 'share' ? withoutAccess : []
  }, [canShare, checkMentionAccess, mentionedUsers, requestGrantAccessChoice, t])

  const handleSubmit = React.useCallback(async () => {
    const trimmedBody = body.trim()
    if (!trimmedBody || !canComment) return
    setIsSubmitting(true)
    try {
      const grantAccessTo = await resolveGrantAccessTo(trimmedBody)
      await runMutation({
        operation: async () => {
          await apiCallOrThrow(
            `/api/documents/${encodeURIComponent(documentId)}/comments`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                body: trimmedBody,
                anchor: pendingAnchor ?? captureSelectionAnchor(),
                parentCommentId,
                ...(grantAccessTo !== undefined ? { grantAccessTo } : {}),
              }),
            },
            { errorMessage: t('documents.comments.error.save') },
          )
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_comment',
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: { body: trimmedBody, parentCommentId, grantAccessTo },
      })
      setBody('')
      setMentionedUsers(new Map())
      setParentCommentId(null)
      setPendingAnchor(null)
      setMentionPickerOpen(false)
      await reload()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.comments.error.save'), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    body,
    canComment,
    captureSelectionAnchor,
    documentId,
    mutationContextId,
    parentCommentId,
    pendingAnchor,
    reload,
    resolveGrantAccessTo,
    retryLastMutation,
    runMutation,
    t,
  ])

  const handleResolve = React.useCallback(async (comment: DocumentComment) => {
    if (!canResolve) return
    setResolvingCommentId(comment.id)
    try {
      await runMutation({
        operation: async () => {
          await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(comment.updatedAt),
            () => apiCallOrThrow(
              `/api/documents/${encodeURIComponent(documentId)}/comments`,
              {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: comment.id, resolved: comment.resolvedAt === null }),
              },
              { errorMessage: t('documents.comments.error.save') },
            ),
          )
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_comment',
          resourceId: comment.id,
          retryLastMutation,
        },
        mutationPayload: { id: comment.id, resolved: comment.resolvedAt === null },
      })
      await reload()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: () => { void reload() } })) {
        flash(t('ui.forms.flash.recordModified'), 'error')
        await reload()
        return
      }
      flash(err instanceof Error ? err.message : t('documents.comments.error.save'), 'error')
    } finally {
      setResolvingCommentId(null)
    }
  }, [canResolve, documentId, mutationContextId, reload, retryLastMutation, runMutation, t])

  const handleReply = React.useCallback((comment: DocumentComment) => {
    setPendingAnchor(null)
    setParentCommentId(comment.id)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  const handleJump = React.useCallback((comment: DocumentComment) => {
    if (!editor || !comment.anchor) return
    const { from, to } = comment.anchor
    const docSize = editor.state.doc.content.size
    if (from < 0 || to < 0 || from > docSize || to > docSize || from >= to) return
    try {
      editor.commands.setTextSelection({ from, to })
      editor.commands.focus()
    } catch {
      return
    }
  }, [editor])

  const handleComposerKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSubmit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setBody('')
      setMentionedUsers(new Map())
      setParentCommentId(null)
      setPendingAnchor(null)
      setMentionPickerOpen(false)
    }
  }, [handleSubmit])

  const handleMentionPick = React.useCallback((user: { id: string; name: string }) => {
    const mentionText = `@${user.name} @[${user.id}]`
    setMentionedUsers((current) => {
      const next = new Map(current)
      next.set(user.id.toLowerCase(), user.name)
      return next
    })
    setBody((current) => `${current}${current.trim().length > 0 ? ' ' : ''}${mentionText}`)
    setMentionPickerOpen(false)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  const comments = state.status === 'ready' ? state.comments : []

  return (
    <>
      <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">{t('documents.comments.title')}</h2>
        </div>
      </div>

      <div className="space-y-4">
        {state.status === 'loading' ? (
          <LoadingMessage label={t('documents.comments.loading')} />
        ) : state.status === 'error' ? (
          <ErrorMessage label={state.message} />
        ) : comments.length === 0 ? (
          <EmptyState
            size="sm"
            variant="subtle"
            title={t('documents.comments.empty')}
            icon={<MessageSquare className="size-5" />}
          />
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                canComment={canComment}
                canResolve={canResolve}
                isResolving={resolvingCommentId === comment.id}
                onJump={handleJump}
                onReply={handleReply}
                onResolve={(nextComment) => void handleResolve(nextComment)}
                t={t}
              />
            ))}
          </div>
        )}

        {canComment ? (
          <form
            ref={composerRef}
            className="space-y-3 rounded-lg border border-border bg-muted/20 p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
            onKeyDown={handleComposerKeyDown}
          >
            <div className="space-y-2">
              <Label htmlFor={composerId}>{t('documents.comments.title')}</Label>
              {parentCommentId ? (
                <p className="inline-flex items-center gap-2 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                  <CornerDownRight className="size-3" aria-hidden="true" />
                  {t('documents.comments.actions.reply')} {shortenId(parentCommentId)}
                </p>
              ) : null}
              <Textarea
                ref={textareaRef}
                id={composerId}
                value={body}
                onChange={(event) => handleBodyChange(event.target.value)}
                placeholder={t('documents.comments.composer.placeholder')}
                maxLength={8000}
                showCount
                disabled={isSubmitting}
              />
            </div>
            {mentionPickerOpen ? (
              <MentionPicker documentId={documentId} onPick={handleMentionPick} disabled={isSubmitting} />
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMentionPickerOpen((current) => !current)}
                disabled={isSubmitting}
              >
                <AtSign />
                {t('documents.comments.actions.mention')}
              </Button>
              <Button type="submit" disabled={isSubmitting || body.trim().length === 0}>
                <Send />
                {t('documents.comments.actions.send')}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
      </section>

      <Dialog
        open={grantAccessPrompt !== null}
        onOpenChange={(open) => {
          if (!open) resolveGrantAccessPrompt('skip')
        }}
      >
        <DialogContent onKeyDown={grantPromptKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('documents.comments.grant.title')}</DialogTitle>
            <DialogDescription>
              {t('documents.comments.grant.body', { names: grantAccessPrompt?.names.join(', ') ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => resolveGrantAccessPrompt('skip')}>
              {t('documents.comments.grant.skip')}
            </Button>
            <Button type="button" onClick={() => resolveGrantAccessPrompt('share')}>
              {t('documents.comments.grant.share')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default CommentsRail
