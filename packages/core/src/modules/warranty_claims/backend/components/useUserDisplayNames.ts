'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value : null
}

function getUserDisplayName(record: Record<string, unknown>): string | null {
  const displayName = toStringOrNull(record.display_name)
    ?? toStringOrNull(record.displayName)
    ?? toStringOrNull(record.name)
  if (displayName) return displayName
  return toStringOrNull(record.email)
}

export function useUserDisplayNames(userIds: readonly (string | null | undefined)[]): Record<string, string> {
  const [userNames, setUserNames] = React.useState<Record<string, string>>({})
  const resolvedUserIdsRef = React.useRef<Set<string>>(new Set())

  const idsKey = React.useMemo(() => {
    const normalized = new Set<string>()
    for (const userId of userIds) {
      const value = toStringOrNull(userId)
      if (value) normalized.add(value)
    }
    return [...normalized].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join(',')
  }, [userIds])

  React.useEffect(() => {
    if (!idsKey) return
    const unresolvedIds = idsKey.split(',').filter((userId) => !resolvedUserIdsRef.current.has(userId)).slice(0, 100)
    if (!unresolvedIds.length) return

    const controller = new AbortController()
    readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `/api/auth/users?ids=${unresolvedIds.map(encodeURIComponent).join(',')}&pageSize=100`,
      { signal: controller.signal },
      {
        errorMessage: '[internal] Failed to load user display names',
      },
    )
      .then((data) => {
        for (const userId of unresolvedIds) resolvedUserIdsRef.current.add(userId)
        const nextNames: Record<string, string> = {}
        for (const user of data.items ?? []) {
          const userId = toStringOrNull(user.id)
          const displayName = getUserDisplayName(user)
          if (userId && displayName) nextNames[userId] = displayName
        }
        if (Object.keys(nextNames).length) {
          setUserNames((current) => ({ ...current, ...nextNames }))
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [idsKey])

  return userNames
}
