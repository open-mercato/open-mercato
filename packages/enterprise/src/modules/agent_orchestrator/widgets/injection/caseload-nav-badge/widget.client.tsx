"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { setNavBadge, clearNavBadge } from '@open-mercato/ui/backend/nav/navBadges'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { OPTIONAL_REQUEST_INIT } from '../../../components/optionalRequest'
import { useCoalescedReload } from '../../../components/useCoalescedReload'

const CASELOAD_HREF = '/backend/caseload'

// One row is enough: the list route returns the unpaginated `total`, so this
// asks the server to count rather than to serialize a queue.
const COUNT_PATH = '/api/agent_orchestrator/proposals?disposition=pending&pageSize=1'

/**
 * Publishes "how many proposals are waiting on a human" onto the Caseload nav
 * item (F7b).
 *
 * Headless by design — it renders nothing and exists only to keep the badge
 * current from wherever the operator happens to be in the backoffice. The
 * count deliberately does NOT ride the chrome payload: `/api/auth/admin/nav` is
 * cached for 30 minutes, which would make a per-user count both stale and
 * cache-poisoning.
 *
 * Liveness is free: `proposal.created` and `proposal.disposed` are already
 * `clientBroadcast`, so the DOM Event Bridge delivers them here; refetches are
 * coalesced so a bulk disposition cannot turn into a burst of counts.
 *
 * A user without `proposals.view` never mounts this (the widget declares the
 * feature), so no request is made on their behalf.
 */
export default function CaseloadNavBadgeWidget() {
  const t = useT()
  const labelRef = React.useRef(t)
  labelRef.current = t

  const refresh = React.useCallback(async () => {
    const call = await apiCall<{ total?: number }>(COUNT_PATH, OPTIONAL_REQUEST_INIT, { fallback: {} })
    // A failed probe clears rather than freezes: a stale "3 waiting" that no
    // longer exists is worse than no chip at all.
    if (!call.ok || typeof call.result?.total !== 'number') {
      clearNavBadge(CASELOAD_HREF)
      return
    }
    const count = call.result.total
    setNavBadge(CASELOAD_HREF, {
      count,
      tone: 'attention',
      label: labelRef.current('agent_orchestrator.caseload.navBadge.label', '{count} waiting for your decision', {
        count: String(count),
      }),
    })
  }, [])

  const reload = useCoalescedReload(() => { void refresh() })

  React.useEffect(() => {
    void refresh()
    return () => clearNavBadge(CASELOAD_HREF)
  }, [refresh])

  useAppEvent('agent_orchestrator.proposal.created', reload, [reload])
  useAppEvent('agent_orchestrator.proposal.disposed', reload, [reload])

  return null
}
