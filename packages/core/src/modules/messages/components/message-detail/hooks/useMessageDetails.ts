"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { BRIDGE_RECONNECTED_EVENT_ID, useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { MessageDetail, MessageDetailDeletion } from '../types'
import { useMessageDetailsQueries } from './useMessageDetailsQueries'
import { useMessageDetailsActions } from './useMessageDetailsActions'
import { useMessageDetailsConversation } from './useMessageDetailsConversation'

export function useMessageDetails(id: string, sharedDeletion?: MessageDetailDeletion) {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()

  const ownDeletion = React.useMemo<MessageDetailDeletion>(() => {
    let pendingDeletes = 0
    let deleted = false
    let refreshController: AbortController | undefined
    return {
      queriesEnabled: () => pendingDeletes === 0 && !deleted,
      getRefreshSignal: () => {
        refreshController ??= new AbortController()
        return refreshController.signal
      },
      runDelete: async (operation) => {
        const detail = queryClient.getQueryData<MessageDetail | null>(['messages', 'detail', id, scopeVersion])
        const messageIds = new Set([id, ...(detail?.thread ?? []).map((message) => message.id)])
        const queries = {
          queryKey: ['messages', 'detail'],
          predicate: ({ queryKey }: { queryKey: readonly unknown[] }) => (
            typeof queryKey[2] === 'string' && messageIds.has(queryKey[2]) && queryKey.at(-1) === scopeVersion
          ),
        }

        pendingDeletes += 1
        refreshController?.abort()
        try {
          await queryClient.cancelQueries(queries)
          const didDelete = await operation()
          if (didDelete) {
            deleted = true
            void queryClient.invalidateQueries({ ...queries, refetchType: 'none' })
          }
          return didDelete
        } finally {
          pendingDeletes -= 1
          if (pendingDeletes === 0 && !deleted) {
            refreshController = undefined
            void queryClient.refetchQueries({ ...queries, type: 'active' })
          }
        }
      },
    }
  }, [id, queryClient, scopeVersion])
  const deletion = sharedDeletion ?? ownDeletion

  const queryState = useMessageDetailsQueries({
    id,
    t,
    scopeVersion,
    queryClient,
    enabled: deletion.queriesEnabled,
    getRefreshSignal: deletion.getRefreshSignal,
  })

  const invalidateMessageQueries = React.useCallback(
    (payload: Record<string, unknown>) => {
      void queryClient.invalidateQueries({ queryKey: ['messages', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['messages', 'detail', id] })
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : null
      if (messageId && messageId !== id) {
        void queryClient.invalidateQueries({ queryKey: ['messages', 'detail', messageId] })
      }
    },
    [id, queryClient],
  )

  useAppEvent(
    'messages.message.*',
    (evt) => {
      invalidateMessageQueries((evt.payload ?? {}) as Record<string, unknown>)
    },
    [invalidateMessageQueries],
  )

  useAppEvent(
    BRIDGE_RECONNECTED_EVENT_ID,
    () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', 'detail', id] })
    },
    [id, queryClient],
  )

  const isArchived = queryState.detail?.isArchived ?? false

  const actionState = useMessageDetailsActions({
    id,
    t,
    detail: queryState.detail,
    refetchDetail: queryState.refetchDetail,
    attachments: queryState.attachments,
    isArchived,
    runDelete: deletion.runDelete,
    onDeleted: () => router.push('/backend/messages'),
    onMarkedUnread: () => router.push('/backend/messages'),
    refreshDetailWithoutAutoMarkRead: queryState.refreshDetailWithoutAutoMarkRead,
    suppressAutoMarkRead: queryState.suppressAutoMarkRead,
  })

  const conversationState = useMessageDetailsConversation({
    detail: queryState.detail,
    t,
  })

  const backToList = React.useCallback(() => {
    router.push('/backend/messages')
  }, [router])

  return {
    t,
    router,
    backToList,
    deletion,
    ...queryState,
    ...conversationState,
    ...actionState,
    isArchived,
  }
}
