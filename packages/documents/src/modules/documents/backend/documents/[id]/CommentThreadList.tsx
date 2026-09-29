"use client"

import * as React from 'react'
import { CheckCircle2, CornerDownRight, RotateCcw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { DocumentComment } from './commentTypes'

type LabelFor = (userId: string) => string
type CommentThreadListProps = {
  comments: DocumentComment[]
  canComment: boolean
  resolvingCommentId: string | null
  labelFor: LabelFor
  onJump: (comment: DocumentComment) => void
  onReply: (comment: DocumentComment) => void
  onResolve: (comment: DocumentComment) => void
  t: TranslateFn
}

const MENTION_TOKEN_PATTERN = /@\[([0-9a-f-]{36})\]/gi

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
    : ''
}

/**
 * Chips are built from the mention tokens themselves. Rendering display
 * labels back into the text and re-matching them corrupted every label that
 * shares a prefix with another mention, and expanded the `$&`/`$1` sequences
 * a user-controlled label may carry into the replacement string.
 */
function formatBody(body: string, labelFor: LabelFor): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const match of body.matchAll(MENTION_TOKEN_PATTERN)) {
    const userId = match[1]
    const start = match.index ?? 0
    if (userId === undefined) continue
    if (start > cursor) parts.push(body.slice(cursor, start))
    parts.push(
      <span key={`mention:${start}`} className="inline-flex rounded-full bg-muted px-2 py-1 text-xs font-medium text-primary">
        @{labelFor(userId)}
      </span>,
    )
    cursor = start + match[0].length
  }
  if (cursor < body.length) parts.push(body.slice(cursor))
  return parts
}

function CommentItem({
  comment,
  canComment,
  resolvingCommentId,
  labelFor,
  onJump,
  onReply,
  onResolve,
  t,
}: CommentThreadListProps & { comment: DocumentComment }) {
  const resolved = comment.resolvedAt !== null
  const canJump = comment.anchor !== null && comment.anchor !== 'changed'
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{labelFor(comment.authorUserId)}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</p>
        </div>
        {resolved ? <StatusBadge variant="success" dot>{t('documents.comments.resolved')}</StatusBadge> : null}
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground">{formatBody(comment.body, labelFor)}</p>
      {comment.anchor === 'changed' ? (
        <p className="text-xs text-muted-foreground">{t('documents.comments.anchor.changed')}</p>
      ) : null}
    </>
  )
  return (
    <article className="space-y-3 rounded-lg border border-border bg-background p-3">
      {canJump ? (
        <Button type="button" variant="ghost" className="h-auto w-full flex-col items-stretch gap-2 p-0 text-left hover:bg-transparent" onClick={() => onJump(comment)}>
          {content}
        </Button>
      ) : <div className="space-y-2">{content}</div>}
      <div className="flex flex-wrap items-center gap-2">
        {canComment && comment.parentCommentId === null ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onReply(comment)}>
            <CornerDownRight />{t('documents.comments.actions.reply')}
          </Button>
        ) : null}
        {comment.canResolve ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onResolve(comment)} disabled={resolvingCommentId === comment.id}>
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
              comments={[]}
              canComment={false}
              resolvingCommentId={resolvingCommentId}
              labelFor={labelFor}
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

export function CommentThreadList(props: CommentThreadListProps) {
  return (
    <div className="space-y-3">
      {props.comments.map((comment) => <CommentItem key={comment.id} {...props} comment={comment} />)}
    </div>
  )
}
