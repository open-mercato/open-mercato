"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { clearNavBadge } from '@open-mercato/ui/backend/nav/navBadges'
import { useNotificationEffect } from '@open-mercato/ui/backend/notifications/useNotificationEffect'
import { PENDING_ACTIONS_HREF } from '../../../components/pending-actions/pendingActionsShared'
import { refreshPendingActionsNavBadge } from '../../../components/pending-actions/pendingActionsNavBadge'

const AWAITING_APPROVAL_NOTIFICATION_TYPE = 'ai_assistant.pending_action.awaiting_approval'
const REFRESH_INTERVAL_MS = 60_000

/**
 * Headless feeder for the Pending AI actions nav badge. Refreshes on mount,
 * when an "awaiting approval" notification arrives, and on a 60-second
 * interval so approvals, rejections and expiries made elsewhere drop out.
 */
export default function PendingActionsNavBadgeWidget() {
  const t = useT()
  const translateRef = React.useRef(t)
  translateRef.current = t

  const refresh = React.useCallback(() => {
    void refreshPendingActionsNavBadge(translateRef.current)
  }, [])

  React.useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      clearNavBadge(PENDING_ACTIONS_HREF)
    }
  }, [refresh])

  useNotificationEffect(AWAITING_APPROVAL_NOTIFICATION_TYPE, refresh, [refresh])

  return null
}
