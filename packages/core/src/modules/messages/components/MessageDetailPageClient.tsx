"use client"

import * as React from 'react'
import { MessageComposer } from '@open-mercato/ui/backend/messages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  getMessageUiComponentRegistry,
} from './utils/typeUiRegistry'
import {
  MessageDetailActionsSection,
  MessageDetailAttachmentsSection,
  MessageDetailBodySection,
  MessageDetailComposerDialogs,
  MessageDetailDialogs,
  MainMessageHeader,
  MessageListComponent,
  MessageHeader,
  MessageDetailMetaSection,
  MessageDetailObjectsSection,
} from './message-detail/detail-panels'
import { useMessageDetails } from './message-detail/hooks/useMessageDetails'

function MessageConversationDetailItem({
  messageId,
  isCollapsible,
  isExpanded,
  onToggle,
  onReply,
  onForward,
}: {
  messageId: string
  isCollapsible: boolean
  isExpanded: boolean
  onToggle: () => void
  onReply: (messageId: string) => void
  onForward: (messageId: string) => void
}) {
  const state = useMessageDetails(messageId)
  const messageUiRegistry = React.useMemo(() => getMessageUiComponentRegistry(), [])

  if (state.isLoadingDetail) {
    return (
      <section className="py-3">
        <LoadingMessage label={state.t('messages.loading.detail', 'Loading message...')} />
      </section>
    )
  }

  if (!state.detail) {
    return (
      <section className="py-3">
        <ErrorMessage label={state.loadErrorMessage} />
      </section>
    )
  }

  const ContentComponent = state.contentComponentKey
    ? messageUiRegistry.contentComponents[state.contentComponentKey] ?? null
    : null
  const ActionsComponent = state.actionsComponentKey
    ? messageUiRegistry.actionsComponents[state.actionsComponentKey] ?? null
    : null

  return (
    <section className="py-3">
      <div className="space-y-4">
        <section className="space-y-2 py-2">
          <MessageHeader
            detail={state.detail}
            updatingState={state.updatingState}
            isArchived={state.isArchived}
            showSubject={false}
            collapseToggle={isCollapsible ? { expanded: isExpanded, onToggle } : undefined}
            onReply={() => onReply(messageId)}
            onForward={() => onForward(messageId)}
            onEdit={() => state.setEditOpen(true)}
            onToggleRead={() => void state.toggleRead()}
            onToggleArchive={() => void state.toggleArchive()}
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
      </div>

      <MessageDetailComposerDialogs
        id={messageId}
        detail={state.detail}
        attachments={state.attachments}
        editOpen={state.editOpen}
        setEditOpen={state.setEditOpen}
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
    </section>
  )
}

function MessageDetailPageClientContent({ id }: { id: string }) {
  const state = useMessageDetails(id)
  const [activeInlineComposer, setActiveInlineComposer] = React.useState<{
    variant: 'reply' | 'forward'
    messageId: string
  } | null>(null)
  const inlineComposerContainerRef = React.useRef<HTMLDivElement | null>(null)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  React.useEffect(() => {
    if (!activeInlineComposer) return

    const composerContainer = inlineComposerContainerRef.current
    if (!composerContainer) return

    const firstFocusableElement = composerContainer.querySelector<HTMLElement>(
      'textarea, input, [contenteditable="true"]',
    )
    firstFocusableElement?.focus()
  }, [activeInlineComposer])

  if (state.isLoadingDetail) {
    return <LoadingMessage label={state.t('messages.loading.detail', 'Loading message...')} />
  }

  if (!state.detail) {
    return (
      <ErrorMessage
        label={state.loadErrorMessage}
        action={(
          <Button type="button" variant="outline" onClick={state.backToList}>
            {state.t('messages.actions.backToList', 'Back to messages')}
          </Button>
        )}
      />
    )
  }

  const detail = state.detail
  const firstConversationMessageId = state.conversationItems[0]?.id ?? null
  const latestConversationMessageId = state.conversationItems[state.conversationItems.length - 1]?.id ?? null
  const canRunConversationActions = Boolean(firstConversationMessageId)

  return (
    <div className="space-y-3">
      <MainMessageHeader
        subject={detail.subject}
        priority={(detail.priority as 'low' | 'normal' | 'high' | 'urgent') ?? 'normal'}
        canReply={!detail.isDraft && detail.typeDefinition.allowReply && Boolean(firstConversationMessageId)}
        canForwardAll={!detail.isDraft && detail.typeDefinition.allowForward && Boolean(latestConversationMessageId)}
        actionsDisabled={Boolean(state.activeConversationAction)}
        activeActionId={state.activeConversationAction}
        onReply={() => {
          if (!firstConversationMessageId) return
          setActiveInlineComposer({
            variant: 'reply',
            messageId: firstConversationMessageId,
          })
        }}
        onForwardAll={() => {
          if (!latestConversationMessageId) return
          setActiveInlineComposer({
            variant: 'forward',
            messageId: latestConversationMessageId,
          })
        }}
        onArchiveConversation={() => {
          if (!canRunConversationActions) return
          void state.archiveConversation(firstConversationMessageId ?? undefined)
        }}
        onMarkAllUnread={() => {
          if (!canRunConversationActions) return
          void state.markConversationUnread(firstConversationMessageId ?? undefined)
        }}
        onDeleteConversation={() => {
          if (!canRunConversationActions || state.activeConversationAction) return
          void (async () => {
            const confirmed = await confirm({
              title: state.t('messages.confirm.deleteConversationTitle', 'Delete conversation'),
              text: state.t('messages.confirm.deleteConversation', 'Delete this conversation from your view?'),
              confirmText: state.t('messages.actions.deleteConversation', 'Delete conversation'),
              cancelText: state.t('common.cancel', 'Cancel'),
              variant: 'destructive',
            })
            if (!confirmed) return
            await state.deleteConversation(firstConversationMessageId ?? undefined)
          })()
        }}
      />
      <div className="divide-y border-y">
        {state.conversationItems.map((item) => {
          const isForcedExpanded = item.id === state.forcedExpandedItemId
          const isExpanded = state.isConversationItemExpanded(item.id)
          if (isExpanded) {
            return (
              <MessageConversationDetailItem
                key={item.id}
                messageId={item.id}
                isCollapsible={!isForcedExpanded}
                isExpanded
                onToggle={() => state.toggleConversationItem(item.id)}
                onReply={(messageId) => {
                  setActiveInlineComposer({
                    variant: 'reply',
                    messageId,
                  })
                }}
                onForward={(messageId) => {
                  setActiveInlineComposer({
                    variant: 'forward',
                    messageId,
                  })
                }}
              />
            )
          }

          return (
            <section key={item.id} className="px-1 py-1">
              <MessageListComponent
                message={state.buildConversationListItemMessage(item)}
                onClick={() => state.toggleConversationItem(item.id)}
              />
            </section>
          )
        })}
      </div>

      {activeInlineComposer ? (
        <div ref={inlineComposerContainerRef}>
          <MessageComposer
            inline
            inlineBackHref={null}
            variant={activeInlineComposer.variant}
            messageId={activeInlineComposer.messageId}
            onCancel={() => {
              setActiveInlineComposer(null)
            }}
            onSuccess={() => {
              setActiveInlineComposer(null)
              void state.detailQuery.refetch()
            }}
          />
        </div>
      ) : null}
      {ConfirmDialogElement}
    </div>
  )
}

export function MessageDetailPageClient({ id, canViewMessages = true }: { id: string; canViewMessages?: boolean }) {
  const t = useT()
  if (!canViewMessages) {
    return (
      <ErrorMessage
        label={t('messages.access.disabled.title', 'Messages module is disabled for your role.')}
        description={t(
          'messages.access.disabled.description',
          'Ask your administrator to enable the required Messages permissions.',
        )}
      />
    )
  }
  return <MessageDetailPageClientContent id={id} />
}
