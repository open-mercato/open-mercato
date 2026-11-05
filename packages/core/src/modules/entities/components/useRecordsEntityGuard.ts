"use client"
import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type RecordsEntityGuardState = 'checking' | 'blocked' | 'allowed'

// Mirrors SYSTEM_ENTITY_RECORDS_BLOCKED_CODE from @open-mercato/shared/lib/data/engine —
// kept as a literal so client bundles do not pull the server-side data engine in.
const SYSTEM_ENTITY_RECORDS_BLOCKED_CODE = 'system_entity_records_blocked'

/**
 * The records surface serves custom entities only; the API rejects system
 * (table-backed) entity ids with 400 + `system_entity_records_blocked` (#2939
 * hardening). Records pages are URL-addressable for any entity id, so they probe
 * once and render a dedicated error state instead of a broken table/form.
 * Fails open on transport errors — the page's own data calls surface those.
 */
export function useRecordsEntityGuard(entityId: string): RecordsEntityGuardState {
  const [state, setState] = React.useState<RecordsEntityGuardState>(entityId ? 'checking' : 'allowed')
  React.useEffect(() => {
    if (!entityId) {
      setState('allowed')
      return
    }
    let cancelled = false
    setState('checking')
    apiCall<{ code?: string }>(`/api/entities/records?entityId=${encodeURIComponent(entityId)}&page=1&pageSize=1`)
      .then((res) => {
        if (cancelled) return
        const blocked = res.status === 400 && res.result?.code === SYSTEM_ENTITY_RECORDS_BLOCKED_CODE
        setState(blocked ? 'blocked' : 'allowed')
      })
      .catch(() => {
        if (!cancelled) setState('allowed')
      })
    return () => {
      cancelled = true
    }
  }, [entityId])
  return state
}
