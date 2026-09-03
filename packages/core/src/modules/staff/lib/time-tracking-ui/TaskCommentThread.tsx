"use client"

import * as React from 'react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DrawerComment } from './taskDrawerData'

export type TaskCommentThreadProps = {
  comments: readonly DrawerComment[]
  loading: boolean
  loadError: boolean
  posting: boolean
  canComment: boolean
  /** Resolves `true` when the comment was written, which is when the box clears. */
  onPost: (body: string) => Promise<boolean>
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
}: TaskCommentThreadProps) {
  const t = useT()
  const [draft, setDraft] = React.useState('')

  const submit = React.useCallback(async () => {
    const body = draft.trim()
    if (!body || posting || !canComment) return
    const saved = await onPost(body)
    if (saved) setDraft('')
  }, [canComment, draft, onPost, posting])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      // Stops the drawer-level handler from seeing the same chord twice.
      event.stopPropagation()
      void submit()
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
            return (
              <li key={comment.id} className="flex items-start gap-2.5" data-comment-id={comment.id}>
                <Avatar label={author} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground">{author}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt) ?? ''}</span>
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
            placeholder={t('staff.time_tracking.taskDrawer.comments.placeholder', 'Write a comment…')}
            aria-label={t('staff.time_tracking.taskDrawer.comments.placeholder', 'Write a comment…')}
            data-testid="task-drawer-comment-input"
          />
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={posting || draft.trim().length === 0}
              onClick={() => { void submit() }}
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
        </div>
      ) : null}
    </section>
  )
}

export default TaskCommentThread
