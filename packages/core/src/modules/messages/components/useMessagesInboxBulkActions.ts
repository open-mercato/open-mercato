"use client"

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { BulkAction } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { toErrorMessage } from './message-detail/utils'

export type MessageFolder = 'inbox' | 'sent' | 'drafts' | 'archived' | 'all'

type MessageBulkActionId = 'markRead' | 'markUnread' | 'archive' | 'delete'

type BulkExecutionSummary = {
  action: MessageBulkActionId
  total: number
  succeeded: number
  failed: number
}

type MessageBulkRequestConfig = {
  method: 'PUT' | 'DELETE'
  buildUrl: (messageId: string) => string
  successKey: string
  successFallback: string
  errorKey: string
  errorFallback: string
}

type MessageInboxBulkMutationContext = {
  actionId: MessageBulkActionId
  messageIds: string[]
  folder: MessageFolder
  page: number
  search: string
  filters: FilterValues
  retryLastMutation: () => Promise<boolean>
}

type UseMessagesInboxBulkActionsInput = {
  folder: MessageFolder
  page: number
  search: string
  filterValues: FilterValues
}

type MessageInboxBulkRow = {
  id: string
}

const MESSAGE_BULK_REQUESTS: Record<MessageBulkActionId, MessageBulkRequestConfig> = {
  markRead: {
    method: 'PUT',
    buildUrl: (messageId) => `/api/messages/${encodeURIComponent(messageId)}/read`,
    successKey: 'messages.bulk.flash.markReadSuccess',
    successFallback: '{count} messages marked as read.',
    errorKey: 'messages.errors.stateChangeFailed',
    errorFallback: 'Failed to update message state.',
  },
  markUnread: {
    method: 'DELETE',
    buildUrl: (messageId) => `/api/messages/${encodeURIComponent(messageId)}/read`,
    successKey: 'messages.bulk.flash.markUnreadSuccess',
    successFallback: '{count} messages marked as unread.',
    errorKey: 'messages.errors.stateChangeFailed',
    errorFallback: 'Failed to update message state.',
  },
  archive: {
    method: 'PUT',
    buildUrl: (messageId) => `/api/messages/${encodeURIComponent(messageId)}/archive`,
    successKey: 'messages.bulk.flash.archiveSuccess',
    successFallback: '{count} messages archived.',
    errorKey: 'messages.errors.stateChangeFailed',
    errorFallback: 'Failed to update message state.',
  },
  delete: {
    method: 'DELETE',
    buildUrl: (messageId) => `/api/messages/${encodeURIComponent(messageId)}`,
    successKey: 'messages.bulk.flash.deleteSuccess',
    successFallback: '{count} messages deleted.',
    errorKey: 'messages.errors.deleteFailed',
    errorFallback: 'Failed to delete message.',
  },
}

function normalizeSelectionScopeValue(value: unknown): unknown {
  if (value == null) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => normalizeSelectionScopeValue(item))
      .filter((item) => item !== undefined)
    return normalized.length > 0 ? normalized : undefined
  }
  if (typeof value === 'object') {
    const normalizedEntries = Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, nestedValue]) => [key, normalizeSelectionScopeValue(nestedValue)] as const)
      .filter(([, nestedValue]) => nestedValue !== undefined)
    if (normalizedEntries.length === 0) return undefined
    return Object.fromEntries(normalizedEntries)
  }
  return value
}

function buildMessageSelectionScopeKey(
  folder: MessageFolder,
  page: number,
  search: string,
  filterValues: FilterValues,
): string {
  return JSON.stringify({
    folder,
    page,
    search: search.trim(),
    filters: normalizeSelectionScopeValue(filterValues) ?? {},
  })
}

async function runWithConcurrency<TItem>(
  items: TItem[],
  limit: number,
  worker: (item: TItem) => Promise<void>,
): Promise<PromiseSettledResult<void>[]> {
  if (items.length === 0) return []

  const results: PromiseSettledResult<void>[] = new Array(items.length)
  let nextIndex = 0

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      try {
        await worker(items[currentIndex])
        results[currentIndex] = { status: 'fulfilled', value: undefined }
      } catch (error) {
        results[currentIndex] = { status: 'rejected', reason: error }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  )

  return results
}

export function useMessagesInboxBulkActions<T extends MessageInboxBulkRow>({
  folder,
  page,
  search,
  filterValues,
}: UseMessagesInboxBulkActionsInput): {
  bulkActions: BulkAction<T>[] | undefined
  selectionScopeKey: string
  injectionContext: Record<string, unknown>
  ConfirmDialogElement: React.ReactNode
} {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<MessageInboxBulkMutationContext>({
    contextId: 'messages-inbox-bulk-actions',
  })

  const selectionScopeKey = React.useMemo(
    () => buildMessageSelectionScopeKey(folder, page, search, filterValues),
    [filterValues, folder, page, search],
  )
  const injectionContext = React.useMemo<Record<string, unknown>>(
    () => ({
      folder,
      page,
      search: search.trim(),
      filters: filterValues,
      retryLastMutation,
    }),
    [filterValues, folder, page, retryLastMutation, search],
  )

  const executeBulkAction = React.useCallback(async (
    actionId: MessageBulkActionId,
    selectedRows: T[],
  ): Promise<boolean> => {
    const messageIds = selectedRows.map((row) => row.id).filter((id) => id.trim().length > 0)
    if (messageIds.length === 0) return false

    if (actionId === 'delete') {
      const confirmed = await confirm({
        title: t('messages.bulk.delete.title', 'Delete {count} messages?', { count: messageIds.length }),
        description: t('messages.bulk.delete.description', 'This removes the selected messages from your view.'),
        confirmText: t('messages.actions.delete', 'Delete'),
        variant: 'destructive',
      })
      if (!confirmed) return false
    }

    const requestConfig = MESSAGE_BULK_REQUESTS[actionId]

    try {
      const summary = await runMutation<BulkExecutionSummary>({
        operation: async () => {
          const results = await runWithConcurrency(messageIds, 5, async (messageId) => {
            const call = await apiCall<{ ok?: boolean }>(requestConfig.buildUrl(messageId), {
              method: requestConfig.method,
            })
            if (!call.ok) {
              throw new Error(
                toErrorMessage(call.result)
                ?? t(requestConfig.errorKey, requestConfig.errorFallback),
              )
            }
          })

          const failed = results.filter((result) => result.status === 'rejected').length
          const succeeded = results.length - failed

          if (succeeded > 0) {
            await queryClient.invalidateQueries({ queryKey: ['messages', 'list'] })
          }

          return {
            action: actionId,
            total: messageIds.length,
            succeeded,
            failed,
          }
        },
        context: {
          actionId,
          messageIds,
          folder,
          page,
          search: search.trim(),
          filters: filterValues,
          retryLastMutation,
        },
        mutationPayload: {
          actionId,
          messageIds,
        },
      })

      if (summary.succeeded === 0) {
        flash(
          t('messages.bulk.flash.failed', 'Failed to process {count} messages.', { count: summary.failed }),
          'error',
        )
        return false
      }

      if (summary.failed > 0) {
        flash(
          t('messages.bulk.flash.partial', '{succeeded} of {total} messages processed; {failed} failed.', {
            succeeded: summary.succeeded,
            total: summary.total,
            failed: summary.failed,
          }),
          'warning',
        )
        return true
      }

      flash(
        t(requestConfig.successKey, requestConfig.successFallback, { count: summary.succeeded }),
        'success',
      )
      return true
    } catch (error) {
      flash(
        error instanceof Error
          ? error.message
          : t(requestConfig.errorKey, requestConfig.errorFallback),
        'error',
      )
      return false
    }
  }, [confirm, filterValues, folder, page, queryClient, retryLastMutation, runMutation, search, t])

  const bulkActions = React.useMemo<BulkAction<T>[] | undefined>(
    () => folder === 'inbox'
      ? [
          {
            id: 'messages-mark-read',
            label: t('messages.actions.markRead', 'Mark read'),
            onExecute: (selectedRows: T[]) => executeBulkAction('markRead', selectedRows),
          },
          {
            id: 'messages-mark-unread',
            label: t('messages.actions.markUnread', 'Mark unread'),
            onExecute: (selectedRows: T[]) => executeBulkAction('markUnread', selectedRows),
          },
          {
            id: 'messages-archive',
            label: t('messages.actions.archive', 'Archive'),
            onExecute: (selectedRows: T[]) => executeBulkAction('archive', selectedRows),
          },
          {
            id: 'messages-delete',
            label: t('messages.actions.delete', 'Delete'),
            destructive: true,
            onExecute: (selectedRows: T[]) => executeBulkAction('delete', selectedRows),
          },
        ]
      : undefined,
    [executeBulkAction, folder, t],
  )

  return {
    bulkActions,
    selectionScopeKey,
    injectionContext,
    ConfirmDialogElement,
  }
}
