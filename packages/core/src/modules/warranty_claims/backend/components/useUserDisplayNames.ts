'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value : null
}

function getUserDisplayName(record: Record<string, unknown>): string | null {
  const displayName = toStringOrNull(record.display_name) ?? toStringOrNull(record.displayName)
  if (displayName) return displayName
  return toStringOrNull(record.email)
}

export function useUserDisplayNames(userIds: readonly (string | null | undefined)[]): Record<string, string> {
  const [userNames, setUserNames] = React.useState<Record<string, string>>({})
  const resolvedUserIdsRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    const unresolvedIds = new Set<string>()
    for (const userId of userIds) {
      const normalized = toStringOrNull(userId)
      if (normalized && !resolvedUserIdsRef.current.has(normalized)) {
        unresolvedIds.add(normalized)
      }
    }
    if (!unresolvedIds.size) return

    for (const userId of unresolvedIds) resolvedUserIdsRef.current.add(userId)

    const controller = new AbortController()
    readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `/api/auth/users?ids=${[...unresolvedIds].map(encodeURIComponent).join(',')}`,
      { signal: controller.signal },
      {
        fallback: { items: [] },
        errorMessage: '[internal] Failed to load user display names',
      },
    )
      .then((data) => {
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
  }, [userIds])

  return userNames
}
