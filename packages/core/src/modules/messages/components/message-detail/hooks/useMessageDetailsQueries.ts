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
  enabled: () => boolean
  getRefreshSignal: () => AbortSignal
}

export function useMessageDetailsQueries({
  id,
  t,
  scopeVersion,
  queryClient,
  enabled,
  getRefreshSignal,
}: UseMessageDetailsQueriesInput) {
  const detailQueryKey = React.useMemo(
    () => ['messages', 'detail', id, scopeVersion],
    [id, scopeVersion],
  )

  const suppressAutoMarkReadRef = React.useRef(false)

  React.useEffect(() => {
    suppressAutoMarkReadRef.current = false
  }, [id])

  const detailQuery = useQuery<MessageDetail | null>({
    queryKey: detailQueryKey,
    enabled,
    queryFn: async ({ signal }) => {
      const detailUrl = suppressAutoMarkReadRef.current
        ? `/api/messages/${encodeURIComponent(id)}?skipMarkRead=1`
        : `/api/messages/${encodeURIComponent(id)}`
      const call = await apiCall<MessageDetail>(detailUrl, { signal })
      if (call.status === 404) {
        return null
      }
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
  const isDetailMissing = detailQuery.isSuccess && detailQuery.data === null
  const loadErrorMessage = isDetailMissing
    ? t('messages.errors.messageDeleted', 'This message is no longer available.')
    : detailQuery.error instanceof Error
      ? detailQuery.error.message
      : t('messages.errors.loadDetailFailed', 'Failed to load message details.')

  const attachmentsQuery = useQuery<MessageAttachment[]>({
    queryKey: ['messages', 'detail', id, 'attachments', scopeVersion],
    enabled,
    queryFn: async ({ signal }) => {
      const call = await apiCall<{ attachments?: MessageAttachment[] }>(
        `/api/messages/${encodeURIComponent(id)}/attachments`,
        { signal },
      )

      if (call.status === 404) {
        return []
      }

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
  const { refetch } = detailQuery

  const refetchDetail = React.useCallback(async () => {
    if (enabled()) await refetch()
  }, [enabled, refetch])

  const refreshDetailWithoutAutoMarkRead = React.useCallback(async () => {
    if (!enabled()) return queryClient.getQueryData<MessageDetail | null>(detailQueryKey) ?? null

    const signal = getRefreshSignal()
    const call = await apiCall<MessageDetail>(
      `/api/messages/${encodeURIComponent(id)}?skipMarkRead=1`,
      { signal },
    ).catch((error: unknown) => {
      if (signal.aborted) return null
      throw error
    })

    if (!call || signal.aborted) return queryClient.getQueryData<MessageDetail | null>(detailQueryKey) ?? null

    if (call.status === 404) {
      queryClient.setQueryData(detailQueryKey, null)
      return null
    }

    if (!call.ok || !call.result) {
      throw new Error(
        toErrorMessage(call.result)
        ?? t('messages.errors.stateChangeFailed', 'Failed to update message state.'),
      )
    }

    queryClient.setQueryData(detailQueryKey, call.result)
    return call.result
  }, [detailQueryKey, enabled, getRefreshSignal, id, queryClient, t])

  const suppressAutoMarkRead = React.useCallback(() => {
    suppressAutoMarkReadRef.current = true
  }, [])

  const listItemComponentKey = detail?.typeDefinition.ui?.listItemComponent ?? null
  const contentComponentKey = detail?.typeDefinition.ui?.contentComponent ?? null
  const actionsComponentKey = detail?.typeDefinition.ui?.actionsComponent ?? null

  return {
    detailQueryKey,
    detailQuery,
    detail,
    isLoadingDetail,
    isDetailMissing,
    loadErrorMessage,
    attachmentsQuery,
    attachments,
    refetchDetail,
    refreshDetailWithoutAutoMarkRead,
    suppressAutoMarkRead,
    listItemComponentKey,
    contentComponentKey,
    actionsComponentKey,
  }
}
