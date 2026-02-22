"use client"

import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import {
  resolveMessageActionsComponent,
  resolveMessageContentComponent,
} from './typeUiRegistry'
import {
  MessageDetailActionsSection,
  MessageDetailAttachmentsSection,
  MessageDetailBodySection,
  MessageDetailComposerDialogs,
  MessageDetailDialogs,
  MessageDetailHeaderSection,
  MessageDetailMetaSection,
  MessageDetailObjectsSection,
  MessageDetailThreadSection,
} from './message-detail/sections'
import { useMessageDetailPage } from './message-detail/useMessageDetailPage'

export function MessageDetailPageClient({ id }: { id: string }) {
  const state = useMessageDetailPage(id)

  if (state.detailQuery.isLoading) {
    return <LoadingMessage label={state.t('messages.loading.detail', 'Loading message...')} />
  }

  if (state.detailQuery.error || !state.detail) {
    const message = state.detailQuery.error instanceof Error
      ? state.detailQuery.error.message
      : state.t('messages.errors.loadDetailFailed', 'Failed to load message details.')
    return (
      <ErrorMessage
        label={message}
        action={(
          <Button type="button" variant="outline" onClick={() => state.router.push('/backend/messages')}>
            {state.t('messages.actions.backToList', 'Back to messages')}
          </Button>
        )}
      />
    )
  }

  const ContentComponent = resolveMessageContentComponent(
    state.detail.typeDefinition.ui?.contentComponent ?? null,
  )
  const ActionsComponent = resolveMessageActionsComponent(
    state.detail.typeDefinition.ui?.actionsComponent ?? null,
  )

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <MessageDetailHeaderSection
          detail={state.detail}
          updatingState={state.updatingState}
          isArchived={state.isArchived}
          onReply={() => state.setReplyOpen(true)}
          onForward={() => state.setForwardOpen(true)}
          onEdit={() => state.setEditOpen(true)}
          onToggleRead={() => {
            void state.requestAndRefresh(
              `/api/messages/${encodeURIComponent(id)}/read`,
              state.detail?.isRead ? 'DELETE' : 'PUT',
              state.detail?.isRead ? { skipDetailAutoMarkRead: true } : undefined,
            )
          }}
          onToggleArchive={() => {
            void state.requestAndRefresh(
              `/api/messages/${encodeURIComponent(id)}/archive`,
              state.isArchived ? 'DELETE' : 'PUT',
            )
          }}
          onDelete={() => state.setDeleteConfirmationOpen(true)}
        />

        <MessageDetailBodySection
          detail={state.detail}
          contentProps={state.contentProps}
          ContentComponent={ContentComponent}
        />

        <MessageDetailMetaSection detail={state.detail} />
      </section>

      <MessageDetailActionsSection
        detail={state.detail}
        messageActions={state.messageActions}
        executingActionId={state.executingActionId}
        ActionsComponent={ActionsComponent}
        onExecuteActionById={state.handleExecuteActionById}
        onExecuteAction={state.handleExecuteAction}
      />

      <MessageDetailObjectsSection
        detail={state.detail}
        objectActionsByObjectId={state.objectActionsByObjectId}
        onExecuteAction={state.handleExecuteAction}
      />

      <MessageDetailAttachmentsSection
        attachmentsQuery={state.attachmentsQuery}
        attachments={state.attachments}
      />

      <MessageDetailThreadSection detail={state.detail} />

      <MessageDetailComposerDialogs
        id={id}
        detail={state.detail}
        attachments={state.attachments}
        editOpen={state.editOpen}
        setEditOpen={state.setEditOpen}
        replyOpen={state.replyOpen}
        setReplyOpen={state.setReplyOpen}
        forwardOpen={state.forwardOpen}
        setForwardOpen={state.setForwardOpen}
        onSuccessNavigate={(messageId) => {
          if (!messageId) return
          state.router.push(`/backend/messages/${messageId}`)
        }}
        onRefresh={() => state.detailQuery.refetch()}
      />

      <MessageDetailDialogs
        pendingActionConfirmation={state.pendingActionConfirmation}
        setPendingActionConfirmation={state.setPendingActionConfirmation}
        executingActionId={state.executingActionId}
        handleConfirmPendingAction={state.handleConfirmPendingAction}
        handleActionConfirmDialogKeyDown={state.handleActionConfirmDialogKeyDown}
        deleteConfirmationOpen={state.deleteConfirmationOpen}
        setDeleteConfirmationOpen={state.setDeleteConfirmationOpen}
        updatingState={state.updatingState}
        handleDelete={state.handleDelete}
        handleDeleteDialogKeyDown={state.handleDeleteDialogKeyDown}
      />
    </div>
  )
}
