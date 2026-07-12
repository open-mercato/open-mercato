"use client"

import * as React from 'react'
import { CheckCircle2, CornerDownRight, RotateCcw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { CommentMention, DocumentComment } from './commentTypes'

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
    : ''
}

function formatBody(body: string, mentions: CommentMention[], labelFor: LabelFor): React.ReactNode[] {
  let readable = body.replace(MENTION_TOKEN_PATTERN, (_token, userId: string) => `@${labelFor(userId)}`)
  for (const mention of mentions) {
    const label = labelFor(mention.userId)
    readable = readable.replace(new RegExp(`@${escapeRegExp(label)}`, 'g'), `\u0000${label}\u0000`)
  }
  return readable.split('\u0000').map((part, index) => index % 2 === 1 ? (
    <span key={`${part}:${index}`} className="inline-flex rounded-full bg-muted px-2 py-1 text-xs font-medium text-primary">
      @{part}
    </span>
  ) : part)
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
      <p className="whitespace-pre-wrap text-sm text-foreground">{formatBody(comment.body, comment.mentions, labelFor)}</p>
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
