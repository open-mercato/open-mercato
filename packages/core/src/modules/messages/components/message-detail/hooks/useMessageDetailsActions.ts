"use client"

import * as React from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { MessageActionsProps, MessageContentProps } from '@open-mercato/shared/modules/messages/types'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type {
  ActionResult,
  MessageAction,
  MessageAttachment,
  MessageDetail,
  PendingActionConfirmation,
} from '../types'
import { isSafeNavigationHref, parseObjectActionId, toErrorMessage } from '../utils'

type RequestAndRefreshOptions = {
  skipDetailAutoMarkRead?: boolean
}

type ConversationActionKind = 'archiveConversation' | 'deleteConversation' | 'markAllUnread'

type MessageDetailMutationContext = {
  resourceKind: 'message' | 'conversation'
  messageId: string
  action: string
  retryLastMutation: () => Promise<boolean>
}

type UseMessageDetailsActionsInput = {
  id: string
  t: TranslateFn
  detail: MessageDetail | null
  detailQuery: UseQueryResult<MessageDetail | null, Error>
  attachments: MessageAttachment[] | undefined
  isArchived: boolean
  onDeleted: () => void
  refreshDetailWithoutAutoMarkRead: () => Promise<MessageDetail | null>
}

function toStateChangeErrorMessage(payload: unknown, t: TranslateFn): string | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const code = (payload as Record<string, unknown>).code
    if (code === 'messages_sender_archive_unsupported') {
      return t(
        'messages.errors.archiveSenderMessageUnsupported',
        'You cannot archive messages you sent.',
      )
    }
  }
  return toErrorMessage(payload)
}

export function useMessageDetailsActions({
  id,
  t,
  detail,
  detailQuery,
  attachments,
  isArchived,
  onDeleted,
  refreshDetailWithoutAutoMarkRead,
}: UseMessageDetailsActionsInput) {
  const [replyOpen, setReplyOpen] = React.useState(false)
  const [forwardOpen, setForwardOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [updatingState, setUpdatingState] = React.useState(false)
  const [executingActionId, setExecutingActionId] = React.useState<string | null>(null)
  const [pendingActionConfirmation, setPendingActionConfirmation] = React.useState<PendingActionConfirmation | null>(null)
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = React.useState(false)
  const [activeConversationAction, setActiveConversationAction] = React.useState<ConversationActionKind | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<MessageDetailMutationContext>({
    contextId: 'messages-detail-actions',
  })

  const requestAndRefresh = React.useCallback(async (
    url: string,
    method: 'PUT' | 'DELETE',
    options?: RequestAndRefreshOptions,
  ) => {
    setUpdatingState(true)
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall<{ ok?: boolean }>(url, { method })
          if (!call.ok) {
            throw new Error(
              toStateChangeErrorMessage(call.result, t)
              ?? t('messages.errors.stateChangeFailed', 'Failed to update message state.'),
            )
          }
          if (options?.skipDetailAutoMarkRead) {
            await refreshDetailWithoutAutoMarkRead()
          } else {
            await detailQuery.refetch()
          }
        },
        context: { resourceKind: 'message', messageId: id, action: 'state-change', retryLastMutation },
        mutationPayload: { messageId: id, action: 'state-change', url, method },
      })
    } catch (err) {
      flash(
        err instanceof Error
          ? err.message
          : t('messages.errors.stateChangeFailed', 'Failed to update message state.'),
        'error',
      )
    } finally {
      setUpdatingState(false)
    }
  }, [detailQuery, id, refreshDetailWithoutAutoMarkRead, retryLastMutation, runMutation, t])

  const handleDelete = React.useCallback(async () => {
    setUpdatingState(true)
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall<{ ok?: boolean }>(`/api/messages/${encodeURIComponent(id)}`, {
            method: 'DELETE',
          })
          if (!call.ok) {
            throw new Error(toErrorMessage(call.result) ?? t('messages.errors.deleteFailed', 'Failed to delete message.'))
          }
        },
        context: { resourceKind: 'message', messageId: id, action: 'delete', retryLastMutation },
        mutationPayload: { messageId: id, action: 'delete' },
      })
      flash(t('messages.flash.deleted', 'Message deleted.'), 'success')
      onDeleted()
    } catch (err) {
      flash(
        err instanceof Error
          ? err.message
          : t('messages.errors.deleteFailed', 'Failed to delete message.'),
        'error',
      )
    } finally {
      setUpdatingState(false)
    }
  }, [id, onDeleted, retryLastMutation, runMutation, t])

  const runConversationAction = React.useCallback(async (
    action: ConversationActionKind,
    options: {
      url: string
      method: 'PUT' | 'DELETE'
      successMessage: string
      skipDetailAutoMarkRead?: boolean
      onSuccess?: () => void
    },
  ) => {
    setActiveConversationAction(action)
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall<{ ok?: boolean; affectedCount?: number }>(options.url, { method: options.method })
          if (!call.ok) {
            throw new Error(
              toErrorMessage(call.result)
              ?? t('messages.errors.conversationActionFailed', 'Failed to update conversation.'),
            )
          }
        },
        context: { resourceKind: 'conversation', messageId: id, action, retryLastMutation },
        mutationPayload: { messageId: id, action, url: options.url, method: options.method },
      })

      flash(options.successMessage, 'success')

      if (options.onSuccess) {
        options.onSuccess()
        return
      }

      if (options.skipDetailAutoMarkRead) {
        await refreshDetailWithoutAutoMarkRead()
      } else {
        await detailQuery.refetch()
      }
    } catch (err) {
      flash(
        err instanceof Error
          ? err.message
          : t('messages.errors.conversationActionFailed', 'Failed to update conversation.'),
        'error',
      )
    } finally {
      setActiveConversationAction(null)
    }
  }, [detailQuery, id, refreshDetailWithoutAutoMarkRead, retryLastMutation, runMutation, t])

  const archiveConversation = React.useCallback(async (messageId?: string) => {
    const targetMessageId = messageId ?? id
    await runConversationAction('archiveConversation', {
      url: `/api/messages/${encodeURIComponent(targetMessageId)}/conversation/archive`,
      method: 'PUT',
      successMessage: t('messages.flash.conversationArchived', 'Conversation archived.'),
    })
  }, [id, runConversationAction, t])

  const markConversationUnread = React.useCallback(async (messageId?: string) => {
    const targetMessageId = messageId ?? id
    await runConversationAction('markAllUnread', {
      url: `/api/messages/${encodeURIComponent(targetMessageId)}/conversation/read`,
      method: 'DELETE',
      successMessage: t('messages.flash.conversationMarkedUnread', 'Conversation marked unread.'),
      skipDetailAutoMarkRead: true,
    })
  }, [id, runConversationAction, t])

  const deleteConversation = React.useCallback(async (messageId?: string) => {
    const targetMessageId = messageId ?? id
    await runConversationAction('deleteConversation', {
      url: `/api/messages/${encodeURIComponent(targetMessageId)}/conversation`,
      method: 'DELETE',
      successMessage: t('messages.flash.conversationDeleted', 'Conversation deleted.'),
      onSuccess: onDeleted,
    })
  }, [id, onDeleted, runConversationAction, t])

  const handleDeleteDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleDelete()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setDeleteConfirmationOpen(false)
    }
  }, [handleDelete])

  const executeAction = React.useCallback(async (action: MessageAction, payload?: Record<string, unknown>) => {
    setExecutingActionId(action.id)
    try {
      const call = await runMutation({
        operation: async () => {
          const result = await apiCall<ActionResult>(
            `/api/messages/${encodeURIComponent(id)}/actions/${encodeURIComponent(action.id)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload ?? {}),
            },
          )

          if (!result.ok) {
            throw new Error(
              toErrorMessage(result.result)
              ?? t('messages.errors.actionFailed', 'Failed to execute action.'),
            )
          }

          return result
        },
        context: { resourceKind: 'message', messageId: id, action: 'execute-action', retryLastMutation },
        mutationPayload: { messageId: id, action: 'execute-action', actionId: action.id },
      })

      flash(t('messages.flash.actionSuccess', 'Action completed.'), 'success')

      const redirectTarget = call.result?.result?.redirect
      if (
        typeof redirectTarget === 'string'
        && redirectTarget.trim().length > 0
        && isSafeNavigationHref(redirectTarget)
      ) {
        window.location.href = redirectTarget
        return
      }

      await detailQuery.refetch()
    } catch (err) {
      flash(
        err instanceof Error
          ? err.message
          : t('messages.errors.actionFailed', 'Failed to execute action.'),
        'error',
      )
    } finally {
      setExecutingActionId(null)
    }
  }, [detailQuery, id, retryLastMutation, runMutation, t])

  const handleExecuteAction = React.useCallback(async (action: MessageAction, payload?: Record<string, unknown>) => {
    if (executingActionId || detail?.actionTaken) return

    if (action.confirmRequired) {
      setPendingActionConfirmation({ action, payload })
      return
    }

    await executeAction(action, payload)
  }, [detail?.actionTaken, executeAction, executingActionId])

  const handleConfirmPendingAction = React.useCallback(async () => {
    if (!pendingActionConfirmation || executingActionId || detail?.actionTaken) return
    const { action, payload } = pendingActionConfirmation
    setPendingActionConfirmation(null)
    await executeAction(action, payload)
  }, [detail?.actionTaken, executeAction, executingActionId, pendingActionConfirmation])

  const handleActionConfirmDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleConfirmPendingAction()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setPendingActionConfirmation(null)
    }
  }, [handleConfirmPendingAction])

  const contentProps = React.useMemo<MessageContentProps>(() => ({
    message: {
      id: detail?.id ?? '',
      type: detail?.type ?? 'default',
      subject: detail?.subject ?? '',
      body: detail?.body ?? '',
      bodyFormat: detail?.bodyFormat ?? 'text',
      priority: (detail?.priority ?? 'normal') as 'low' | 'normal' | 'high' | 'urgent',
      sentAt: detail?.sentAt ? new Date(detail.sentAt) : null,
      senderName: detail?.senderName ?? undefined,
      senderUserId: detail?.senderUserId ?? '',
      actionData: detail?.actionData ?? null,
      actionTaken: detail?.actionTaken ?? null,
      actionTakenAt: detail?.actionTakenAt ? new Date(detail.actionTakenAt) : null,
    },
    objects: (detail?.objects ?? []).map((item) => ({
      id: item.id,
      entityModule: item.entityModule,
      entityType: item.entityType,
      entityId: item.entityId,
      actionRequired: item.actionRequired,
      snapshot: item.snapshot ?? undefined,
    })),
    attachments: (attachments ?? []).map((item) => ({
      id: item.id,
      fileName: item.fileName,
      fileSize: item.fileSize,
      mimeType: item.mimeType,
      url: item.url,
    })),
  }), [attachments, detail])

  const handleExecuteActionById = React.useCallback<MessageActionsProps['onExecuteAction']>(async (actionId, payload) => {
    const action = detail?.actionData?.actions?.find((entry) => {
      if (parseObjectActionId(entry.id)) return false
      return entry.id === actionId
    })
    if (!action) return
    await handleExecuteAction(action, payload)
  }, [detail?.actionData?.actions, handleExecuteAction])

  const messageActions = React.useMemo(() => {
    return (detail?.actionData?.actions ?? []).filter((action) => !parseObjectActionId(action.id))
  }, [detail?.actionData?.actions])

  const objectActionsByObjectId = React.useMemo(() => {
    const byObjectId = new Map<string, Map<string, MessageAction>>()
    for (const action of detail?.actionData?.actions ?? []) {
      const parsed = parseObjectActionId(action.id)
      if (!parsed) continue
      const current = byObjectId.get(parsed.objectId) ?? new Map<string, MessageAction>()
      current.set(parsed.actionId, action)
      byObjectId.set(parsed.objectId, current)
    }
    return byObjectId
  }, [detail?.actionData?.actions])

  const toggleRead = React.useCallback(async () => {
    await requestAndRefresh(
      `/api/messages/${encodeURIComponent(id)}/read`,
      detail?.isRead ? 'DELETE' : 'PUT',
      detail?.isRead ? { skipDetailAutoMarkRead: true } : undefined,
    )
  }, [detail?.isRead, id, requestAndRefresh])

  const toggleArchive = React.useCallback(async () => {
    await requestAndRefresh(
      `/api/messages/${encodeURIComponent(id)}/archive`,
      isArchived ? 'DELETE' : 'PUT',
    )
  }, [id, isArchived, requestAndRefresh])

  return {
    replyOpen,
    setReplyOpen,
    forwardOpen,
    setForwardOpen,
    editOpen,
    setEditOpen,
    updatingState,
    executingActionId,
    pendingActionConfirmation,
    setPendingActionConfirmation,
    deleteConfirmationOpen,
    setDeleteConfirmationOpen,
    activeConversationAction,
    toggleRead,
    toggleArchive,
    archiveConversation,
    deleteConversation,
    markConversationUnread,
    requestAndRefresh,
    handleDelete,
    handleDeleteDialogKeyDown,
    handleExecuteAction,
    handleConfirmPendingAction,
    handleActionConfirmDialogKeyDown,
    contentProps,
    handleExecuteActionById,
    messageActions,
    objectActionsByObjectId,
  }
}
