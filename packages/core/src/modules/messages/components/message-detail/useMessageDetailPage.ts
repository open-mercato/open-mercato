"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { MessageActionsProps, MessageContentProps } from '@open-mercato/shared/modules/messages/types'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type {
  ActionResult,
  MessageAction,
  MessageAttachment,
  MessageDetail,
  PendingActionConfirmation,
} from './types'
import { parseObjectActionId, toErrorMessage } from './utils'

export function useMessageDetailPage(id: string) {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()

  const [replyOpen, setReplyOpen] = React.useState(false)
  const [forwardOpen, setForwardOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [updatingState, setUpdatingState] = React.useState(false)
  const [executingActionId, setExecutingActionId] = React.useState<string | null>(null)
  const [pendingActionConfirmation, setPendingActionConfirmation] = React.useState<PendingActionConfirmation | null>(null)
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = React.useState(false)

  const detailQuery = useQuery({
    queryKey: ['messages', 'detail', id, scopeVersion],
    queryFn: async () => {
      const call = await apiCall<MessageDetail>(`/api/messages/${encodeURIComponent(id)}`)
      if (!call.ok || !call.result) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('messages.errors.loadDetailFailed', 'Failed to load message details.'),
        )
      }
      return call.result
    },
  })

  const detail = detailQuery.data ?? null

  const attachmentsQuery = useQuery({
    queryKey: ['messages', 'detail', id, 'attachments', scopeVersion],
    queryFn: async () => {
      const call = await apiCall<{ attachments?: MessageAttachment[] }>(
        `/api/messages/${encodeURIComponent(id)}/attachments`,
      )

      if (!call.ok) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('messages.errors.loadDetailFailed', 'Failed to load message details.'),
        )
      }

      return call.result?.attachments ?? []
    },
  })

  const attachments = attachmentsQuery.data

  const requestAndRefresh = React.useCallback(async (url: string, method: 'PUT' | 'DELETE') => {
    setUpdatingState(true)
    try {
      const call = await apiCall<{ ok?: boolean }>(url, { method })
      if (!call.ok) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('messages.errors.stateChangeFailed', 'Failed to update message state.'),
        )
      }
      await detailQuery.refetch()
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
  }, [detailQuery, t])

  const handleDelete = React.useCallback(async () => {
    setUpdatingState(true)
    try {
      const call = await apiCall<{ ok?: boolean }>(`/api/messages/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!call.ok) {
        throw new Error(toErrorMessage(call.result) ?? t('messages.errors.deleteFailed', 'Failed to delete message.'))
      }
      flash(t('messages.flash.deleted', 'Message deleted.'), 'success')
      router.push('/backend/messages')
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
  }, [id, router, t])

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
      const call = await apiCall<ActionResult>(
        `/api/messages/${encodeURIComponent(id)}/actions/${encodeURIComponent(action.id)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
        },
      )

      if (!call.ok) {
        throw new Error(
          toErrorMessage(call.result)
          ?? t('messages.errors.actionFailed', 'Failed to execute action.'),
        )
      }

      flash(t('messages.flash.actionSuccess', 'Action completed.'), 'success')

      const redirectTarget = call.result?.result?.redirect
      if (typeof redirectTarget === 'string' && redirectTarget.trim().length > 0) {
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
  }, [detailQuery, id, t])

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

  const isArchived = (detail?.recipients ?? []).some((item) => item.status === 'archived')

  return {
    t,
    router,
    detailQuery,
    detail,
    attachmentsQuery,
    attachments,
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
    isArchived,
  }
}
