"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { MessageSquare } from 'lucide-react'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
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
import type { CommentAnchor } from './CommentAnchorNavigation'
import { CommentComposer } from './CommentComposer'
import { CommentThreadList } from './CommentThreadList'
import { resolveCommentsCapability, type DocumentTier } from './componentCapabilities'
import { useDocumentComments } from './useDocumentComments'

type CommentFocusRequest = { anchor: CommentAnchor; requestId: number }
export type { DocumentTier } from './componentCapabilities'
export { resolveCommentsCapability } from './componentCapabilities'

type CommentsRailProps = {
  documentId: string
  editor: Editor | null
  commentFocusRequest?: CommentFocusRequest | null
  /** Legacy compatibility; an explicit capability projection takes precedence. */
  tier?: DocumentTier
  canComment?: boolean
  canShare?: boolean
}

export function CommentsRail({
  documentId,
  editor,
  commentFocusRequest,
  tier,
  canComment,
  canShare = false,
}: CommentsRailProps) {
  const t = useT()
  const mayComment = resolveCommentsCapability(canComment, tier)
  const composerRef = React.useRef<HTMLFormElement | null>(null)
  const comments = useDocumentComments({ documentId, editor, canComment: mayComment, canShare })

  React.useEffect(() => {
    if (!commentFocusRequest || !mayComment) return
    comments.setPendingAnchor(commentFocusRequest.anchor)
    window.setTimeout(() => composerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0)
  }, [commentFocusRequest, comments.setPendingAnchor, mayComment])

  const grantPromptKeyDown = useDialogKeyHandler({
    onConfirm: () => comments.chooseGrantAccess(true),
    onCancel: () => comments.chooseGrantAccess(false),
  })

  return (
    <>
      <section className="rounded-lg border border-border bg-card p-3 sm:p-4">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">{t('documents.comments.title')}</h2>
        </div>
        <div className="space-y-4">
          {comments.state.status === 'loading' ? <LoadingMessage label={t('documents.comments.loading')} /> : null}
          {comments.state.status === 'error' ? (
            <ErrorMessage
              label={comments.state.message}
              action={<Button type="button" size="sm" variant="outline" onClick={() => void comments.reload()}>{t('documents.actions.retry')}</Button>}
            />
          ) : null}
          {comments.state.status === 'ready' && comments.comments.length === 0 ? (
            <EmptyState size="sm" variant="subtle" title={t('documents.comments.empty')} icon={<MessageSquare className="size-5" />} />
          ) : null}
          {comments.state.status === 'ready' && comments.comments.length > 0 ? (
            <CommentThreadList
              comments={comments.comments}
              canComment={mayComment}
              resolvingCommentId={comments.resolvingCommentId}
              labelFor={comments.labelFor}
              onJump={(comment) => {
                void (async () => {
                  if (!editor || comment.anchor === null || comment.anchor === 'changed') {
                    flash(t('documents.comments.anchor.changed'), 'info')
                    return
                  }
                  const { jumpToCommentAnchor } = await import('./CommentAnchorNavigation')
                  if (!jumpToCommentAnchor(editor, comment.anchor)) {
                    flash(t('documents.comments.anchor.changed'), 'info')
                  }
                })()
              }}
              onReply={comments.startReply}
              onResolve={(comment) => void comments.resolveComment(comment)}
              t={t}
            />
          ) : null}
          {mayComment ? (
            <CommentComposer
              ref={composerRef}
              documentId={documentId}
              body={comments.body}
              pendingMentions={comments.pendingMentions}
              replyToName={comments.replyToName}
              isSubmitting={comments.isSubmitting}
              onBodyChange={comments.setBody}
              onMentionsChange={comments.setPendingMentions}
              onSubmit={() => void comments.submit()}
              onCancel={comments.resetComposer}
              focusSignal={commentFocusRequest?.requestId ?? comments.parentCommentId ?? undefined}
            />
          ) : null}
        </div>
      </section>
      <Dialog open={comments.grantAccessNames !== null} onOpenChange={(open) => { if (!open) comments.chooseGrantAccess(false) }}>
        <DialogContent onKeyDown={grantPromptKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('documents.comments.grant.title')}</DialogTitle>
            <DialogDescription>{t('documents.comments.grant.body', { names: comments.grantAccessNames?.join(', ') ?? '' })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => comments.chooseGrantAccess(false)}>{t('documents.comments.grant.skip')}</Button>
            <Button type="button" onClick={() => comments.chooseGrantAccess(true)}>{t('documents.comments.grant.share')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default CommentsRail
