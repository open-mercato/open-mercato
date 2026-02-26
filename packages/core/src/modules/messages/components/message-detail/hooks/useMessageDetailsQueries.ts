"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { MessageAttachment, MessageDetail } from '../types'
import { toErrorMessage } from '../utils'

type UseMessageDetailsQueriesInput = {
  id: string
  t: TranslateFn
  scopeVersion: unknown
  queryClient: QueryClient
}

export function useMessageDetailsQueries({
  id,
  t,
  scopeVersion,
  queryClient,
}: UseMessageDetailsQueriesInput) {
  const detailQueryKey = React.useMemo(
    () => ['messages', 'detail', id, scopeVersion],
    [id, scopeVersion],
  )

  const detailQuery = useQuery({
    queryKey: detailQueryKey,
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
  const isLoadingDetail = detailQuery.isLoading
  const loadErrorMessage = detailQuery.error instanceof Error
    ? detailQuery.error.message
    : t('messages.errors.loadDetailFailed', 'Failed to load message details.')

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

  const refreshDetailWithoutAutoMarkRead = React.useCallback(async () => {
    const call = await apiCall<MessageDetail>(
      `/api/messages/${encodeURIComponent(id)}?skipMarkRead=1`,
    )

    if (!call.ok || !call.result) {
      throw new Error(
        toErrorMessage(call.result)
        ?? t('messages.errors.stateChangeFailed', 'Failed to update message state.'),
      )
    }

    queryClient.setQueryData(detailQueryKey, call.result)
    return call.result
  }, [detailQueryKey, id, queryClient, t])

  const listItemComponentKey = detail?.typeDefinition.ui?.listItemComponent ?? null
  const contentComponentKey = detail?.typeDefinition.ui?.contentComponent ?? null
  const actionsComponentKey = detail?.typeDefinition.ui?.actionsComponent ?? null

  return {
    detailQueryKey,
    detailQuery,
    detail,
    isLoadingDetail,
    loadErrorMessage,
    attachmentsQuery,
    attachments,
    refreshDetailWithoutAutoMarkRead,
    listItemComponentKey,
    contentComponentKey,
    actionsComponentKey,
  }
}
