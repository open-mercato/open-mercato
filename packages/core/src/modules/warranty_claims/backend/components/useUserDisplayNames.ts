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
    const unresolvedIds = idsKey.split(',').filter((userId) => !resolvedUserIdsRef.current.has(userId))
    if (!unresolvedIds.length) return

    const controller = new AbortController()
    const load = async () => {
      const users: Array<Record<string, unknown>> = []
      for (let offset = 0; offset < unresolvedIds.length; offset += 100) {
        const batch = unresolvedIds.slice(offset, offset + 100)
        const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/warranty_claims/assignees?ids=${batch.map(encodeURIComponent).join(',')}`,
          { signal: controller.signal },
          { errorMessage: '[internal] Failed to load user display names' },
        )
        users.push(...(data.items ?? []))
      }
      if (!controller.signal.aborted) {
        for (const userId of unresolvedIds) resolvedUserIdsRef.current.add(userId)
        const nextNames: Record<string, string> = {}
        for (const user of users) {
          const userId = toStringOrNull(user.id)
          const displayName = getUserDisplayName(user)
          if (userId && displayName) nextNames[userId] = displayName
        }
        if (Object.keys(nextNames).length) {
          setUserNames((current) => ({ ...current, ...nextNames }))
        }
      }
    }
    void load().catch(() => {})
    return () => controller.abort()
  }, [idsKey])

  return userNames
}
