'use client'

import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { buildUserDisplayNamesUrl, normalizeUserIds, toUserDisplayNames, type UserListItem } from './user-display-names'

const FIVE_MINUTES = 5 * 60 * 1000
const NO_NAMES: Record<string, string> = {}

export function useUserDisplayNames(ids: ReadonlyArray<string | null | undefined>): Record<string, string> {
  const userIds = normalizeUserIds(ids)
  const query = useQuery({
    queryKey: ['document-generators', 'user-display-names', userIds],
    enabled: userIds.length > 0,
    staleTime: FIVE_MINUTES,
    retry: false,
    queryFn: async () => {
      const call = await apiCall<{ items?: UserListItem[] }>(buildUserDisplayNamesUrl(userIds))
      if (!call.ok || !call.result) return {}
      return toUserDisplayNames(call.result.items ?? [])
    },
  })
  return query.data ?? NO_NAMES
}
