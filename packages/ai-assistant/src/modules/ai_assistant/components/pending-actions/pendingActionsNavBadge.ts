'use client'

import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { clearNavBadge, setNavBadge } from '@open-mercato/ui/backend/nav/navBadges'
import {
  OPTIONAL_REQUEST_HEADERS,
  PENDING_ACTIONS_API_PATH,
  PENDING_ACTIONS_HREF,
} from './pendingActionsShared'

export const PENDING_ACTIONS_COUNT_PATH = `${PENDING_ACTIONS_API_PATH}?status=pending&pageSize=1`

/**
 * Publishes the caller's pending AI action count onto the Pending AI actions
 * nav item. A failed probe clears the badge instead of keeping a stale count.
 */
export async function refreshPendingActionsNavBadge(t: TranslateFn): Promise<void> {
  try {
    const call = await apiCall<{ total?: number }>(
      PENDING_ACTIONS_COUNT_PATH,
      { headers: OPTIONAL_REQUEST_HEADERS },
      { fallback: {} },
    )
    if (!call.ok || typeof call.result?.total !== 'number') {
      clearNavBadge(PENDING_ACTIONS_HREF)
      return
    }
    const count = call.result.total
    setNavBadge(PENDING_ACTIONS_HREF, {
      count,
      tone: 'attention',
      label: t('ai_assistant.pendingActions.navBadge.label', '{count} AI actions awaiting approval', {
        count: String(count),
      }),
    })
  } catch {
    clearNavBadge(PENDING_ACTIONS_HREF)
  }
}
