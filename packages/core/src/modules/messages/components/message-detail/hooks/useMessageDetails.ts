"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useMessageDetailsQueries } from './useMessageDetailsQueries'
import { useMessageDetailsActions } from './useMessageDetailsActions'
import { useMessageDetailsConversation } from './useMessageDetailsConversation'
import { messageListHref, parseMessageFolder } from '../../messageFolderRoutes'

export function useMessageDetails(id: string) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const listHref = messageListHref(parseMessageFolder(searchParams?.get('folder')))
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()

  const queryState = useMessageDetailsQueries({
    id,
    t,
    scopeVersion,
    queryClient,
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
    'om:bridge:reconnected',
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
    detailQuery: queryState.detailQuery,
    attachments: queryState.attachments,
    isArchived,
    onDeleted: () => router.push(listHref),
    onMarkedUnread: () => router.push(listHref),
    refreshDetailWithoutAutoMarkRead: queryState.refreshDetailWithoutAutoMarkRead,
    suppressAutoMarkRead: queryState.suppressAutoMarkRead,
  })

  const conversationState = useMessageDetailsConversation({
    detail: queryState.detail,
    t,
  })

  const backToList = React.useCallback(() => {
    router.push(listHref)
  }, [router, listHref])

  return {
    t,
    router,
    backToList,
    listHref,
    ...queryState,
    ...conversationState,
    ...actionState,
    isArchived,
  }
}
