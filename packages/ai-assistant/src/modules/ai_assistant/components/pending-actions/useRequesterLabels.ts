'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { OPTIONAL_REQUEST_HEADERS } from './pendingActionsShared'

type UserLookupItem = { id?: unknown; name?: unknown; email?: unknown }

function readLabel(item: UserLookupItem): string | null {
  if (typeof item.name === 'string' && item.name.trim().length > 0) return item.name
  if (typeof item.email === 'string' && item.email.trim().length > 0) return item.email
  return null
}

/**
 * Best-effort user id → display label map for requester columns. Uses the
 * users list route (`auth.users.list`); callers without that feature get an
 * empty map and the UI falls back to the short id.
 */
export function useRequesterLabels(userIds: ReadonlyArray<string | null | undefined>): Record<string, string> {
  const idsKey = React.useMemo(() => {
    const unique = new Set<string>()
    for (const userId of userIds) {
      if (typeof userId === 'string' && userId.length > 0) unique.add(userId)
    }
    return [...unique].sort((left, right) => left.localeCompare(right)).slice(0, 100).join(',')
  }, [userIds])

  const query = useQuery<Record<string, string>>({
    queryKey: ['ai_assistant', 'pending_actions', 'requesters', idsKey],
    enabled: idsKey.length > 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const call = await apiCall<{ items?: UserLookupItem[] }>(
        `/api/auth/users?ids=${encodeURIComponent(idsKey)}&pageSize=100`,
        { headers: OPTIONAL_REQUEST_HEADERS },
        { fallback: null },
      )
      if (!call.ok || !Array.isArray(call.result?.items)) return {}
      const labels: Record<string, string> = {}
      for (const item of call.result.items) {
        const label = readLabel(item)
        if (typeof item.id === 'string' && label) labels[item.id] = label
      }
      return labels
    },
  })

  return query.data ?? {}
}
