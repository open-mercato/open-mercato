'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import type { PendingActionItem } from './pendingActionsShared'
import { shortId } from './pendingActionsShared'

export type RequesterLabelProps = {
  requester: PendingActionItem['requester']
  labels: Record<string, string>
}

export function RequesterLabel({ requester, labels }: RequesterLabelProps) {
  const t = useT()
  const { userId, apiKeyId } = requester
  if (!userId && !apiKeyId) {
    return <span className="text-muted-foreground">—</span>
  }
  const userLabel = userId ? labels[userId] ?? null : null
  return (
    <div className="flex flex-col gap-0.5" data-pending-action-requester>
      {userId ? (
        userLabel ? (
          <SimpleTooltip content={userId}>
            <span className="truncate">{userLabel}</span>
          </SimpleTooltip>
        ) : (
          <SimpleTooltip content={userId}>
            <span className="font-mono text-xs">{shortId(userId)}</span>
          </SimpleTooltip>
        )
      ) : null}
      {apiKeyId ? (
        <SimpleTooltip content={apiKeyId}>
          <span className="text-xs text-muted-foreground">
            {t('ai_assistant.pendingActions.requester.apiKey', 'API key {id}', { id: shortId(apiKeyId) })}
          </span>
        </SimpleTooltip>
      ) : null}
    </div>
  )
}

export default RequesterLabel
