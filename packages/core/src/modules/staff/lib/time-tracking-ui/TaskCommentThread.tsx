"use client"

import * as React from 'react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DrawerComment } from './taskDrawerData'

export type CommentVisibility = 'internal' | 'customer'

export type TaskCommentThreadProps = {
  comments: readonly DrawerComment[]
  loading: boolean
  loadError: boolean
  posting: boolean
  canComment: boolean
  /** Resolves `true` when the comment was written, which is when the box clears. */
  onPost: (body: string, visibility: CommentVisibility) => Promise<boolean>
  /**
   * `support` is a customer portal ticket: the composer offers two explicit buttons,
   * "Reply to customer" and "Add internal note", so nothing reaches the customer by a
   * hidden default. ⌘↵ in support mode always adds an internal note.
   */
  mode?: 'internal' | 'support'
  /** Retracts a staff reply from the customer's view (support mode only). */
  onMakeInternal?: (comment: DrawerComment) => Promise<void> | void
}

/**
 * The comment thread of screen 7 (US-C4).
 *
 * Deliberately not `NotesSection`: that component is a detail-page *tab* —
 * markdown toolbar, appearance dialog, deal linking, sort control, ~1400 lines —
 * and screen 7 asks for a conversation strip with a two-line composer. The API is
 * task-scoped (`/tasks/{id}/comments`) rather than the shared notes adapter, so
 * reusing it would mean adapting a large surface to hide most of it.
 *
 * Oldest first, because the drawer is read top to bottom; ⌘↵ posts, which is the
 * shortcut the mockup prints under the box.
 */
export function TaskCommentThread({
  comments,
  loading,
  loadError,
  posting,
  canComment,
  onPost,
  mode = 'internal',
  onMakeInternal,
}: TaskCommentThreadProps) {
  const t = useT()
  const [draft, setDraft] = React.useState('')
  const supportMode = mode === 'support'

  const submit = React.useCallback(async (visibility: CommentVisibility = 'internal') => {
    const body = draft.trim()
    if (!body || posting || !canComment) return
    const saved = await onPost(body, visibility)
    if (saved) setDraft('')
  }, [canComment, draft, onPost, posting])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      // Stops the drawer-level handler from seeing the same chord twice.
      event.stopPropagation()
      void submit('internal')
    },
    [submit],
  )

  return (
    <section className="flex flex-col gap-3" data-testid="task-drawer-comments">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('staff.time_tracking.taskDrawer.comments.title', 'Comments ({count})', { count: comments.length })}
      </h3>

      {loading ? (
        <LoadingMessage label={t('staff.time_tracking.taskDrawer.comments.loading', 'Loading the thread…')} />
      ) : loadError ? (
        <ErrorMessage label={t('staff.time_tracking.taskDrawer.comments.loadError', 'Could not load the comments.')} />
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('staff.time_tracking.taskDrawer.comments.empty', 'No comments yet.')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => {
            const author =
              comment.authorName
              ?? comment.authorEmail
              ?? t('staff.time_tracking.taskDrawer.comments.unknownAuthor', 'Unknown author')
            const fromCustomer = comment.authorKind === 'customer'
            const visibleToCustomer = comment.visibility === 'customer'
            return (
              <li
                key={comment.id}
                className={
                  fromCustomer
                    ? 'flex items-start gap-2.5 rounded-md border border-border bg-muted px-2.5 py-2'
                    : 'flex items-start gap-2.5'
                }
                data-comment-id={comment.id}
                data-comment-visibility={comment.visibility}
                data-comment-author-kind={comment.authorKind}
              >
                <Avatar label={author} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground">{author}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt) ?? ''}</span>
                    {fromCustomer ? (
                      <Badge variant="neutral">
                        {t('staff.time_tracking.taskComments.fromCustomer', 'Customer')}
                      </Badge>
                    ) : visibleToCustomer ? (
                      <Badge variant="info" data-testid="task-comment-customer-visible">
                        {t('staff.time_tracking.taskComments.visibleToCustomer', 'Visible to customer')}
                      </Badge>
                    ) : supportMode ? (
                      <Badge variant="muted">
                        {t('staff.time_tracking.taskComments.internalNote', 'Internal note')}
                      </Badge>
                    ) : null}
                    {supportMode && visibleToCustomer && !fromCustomer && onMakeInternal && canComment ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => { void onMakeInternal(comment) }}
                        data-testid="task-comment-make-internal"
                      >
                        {t('staff.time_tracking.taskComments.makeInternal', 'Make internal')}
                      </Button>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-normal text-foreground">
                    {comment.body}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canComment ? (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={2}
            value={draft}
            disabled={posting}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              supportMode
                ? t('staff.time_tracking.taskComments.supportPlaceholder', 'Write a reply or an internal note…')
                : t('staff.time_tracking.taskDrawer.comments.placeholder', 'Write a comment…')
            }
            aria-label={t('staff.time_tracking.taskDrawer.comments.placeholder', 'Write a comment…')}
            data-testid="task-drawer-comment-input"
          />
          {supportMode ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={posting || draft.trim().length === 0}
                onClick={() => { void submit('customer') }}
                data-testid="task-drawer-comment-reply-customer"
              >
                {t('staff.time_tracking.taskComments.replyToCustomer', 'Reply to customer')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={posting || draft.trim().length === 0}
                onClick={() => { void submit('internal') }}
                data-testid="task-drawer-comment-internal-note"
              >
                {t('staff.time_tracking.taskComments.addInternalNote', 'Add internal note')}
              </Button>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
                {t('staff.time_tracking.taskComments.shortcutInternal', 'adds an internal note')}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="sm"
                disabled={posting || draft.trim().length === 0}
                onClick={() => { void submit('internal') }}
                data-testid="task-drawer-comment-submit"
              >
                {t('staff.time_tracking.taskDrawer.comments.submit', 'Comment')}
              </Button>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
                {t('staff.time_tracking.taskDrawer.comments.hint', 'posts')}
              </span>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

export default TaskCommentThread
