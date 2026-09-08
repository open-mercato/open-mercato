'use client'

import * as React from 'react'
import { resolveDeviceUserOptions } from './userOptions'

// Resolves owner ids that are on screen into display labels. Modelled on
// warranty_claims/backend/components/useUserDisplayNames, but every failure degrades to an empty
// map instead of throwing: a devices admin without `auth.users.list` must still see the page.
export function useDeviceUserLabels(userIds: readonly (string | null | undefined)[]): Record<string, string> {
  const [labels, setLabels] = React.useState<Record<string, string>>({})
  const resolvedIdsRef = React.useRef<Set<string>>(new Set())

  const idsKey = React.useMemo(() => {
    const normalized = new Set<string>()
    for (const userId of userIds) {
      if (typeof userId === 'string' && userId.trim()) normalized.add(userId.trim())
    }
    return Array.from(normalized)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .join(',')
  }, [userIds])

  React.useEffect(() => {
    if (!idsKey) return
    const unresolved = idsKey.split(',').filter((userId) => !resolvedIdsRef.current.has(userId))
    if (unresolved.length === 0) return

    const controller = new AbortController()
    void resolveDeviceUserOptions(unresolved, controller.signal)
      .then(({ options, resolvedIds }) => {
        if (controller.signal.aborted) return
        // Only ids the server actually answered for are remembered. Marking an id whose request
        // failed would keep its row showing a bare UUID for the life of the component, even though
        // the next attempt would have worked.
        for (const userId of resolvedIds) resolvedIdsRef.current.add(userId)
        const next: Record<string, string> = {}
        for (const option of options) next[option.value] = option.label
        if (Object.keys(next).length) setLabels((current) => ({ ...current, ...next }))
      })
      .catch(() => {})
    return () => controller.abort()
  }, [idsKey])

  return labels
}
