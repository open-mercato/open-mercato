"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ObjectDetailProps } from '@open-mercato/shared/modules/messages/types'
import { Button } from '@open-mercato/ui/primitives/button'

function readSnapshotLabel(snapshot: Record<string, unknown> | undefined): string | null {
  if (!snapshot) return null

  const candidates = ['subject', 'title', 'name', 'label', 'id']
  for (const key of candidates) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function readSnapshotSubtitle(snapshot: Record<string, unknown> | undefined): string | null {
  if (!snapshot) return null

  const candidates = ['type', 'status']
  for (const key of candidates) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

export function MessageRecordObjectDetail({
  entityId,
  snapshot,
  actionRequired,
  actionLabel,
  actions,
  onAction,
}: ObjectDetailProps) {
  const t = useT()
  const [executingActionId, setExecutingActionId] = React.useState<string | null>(null)

  const label = readSnapshotLabel(snapshot) ?? entityId
  const subtitle = readSnapshotSubtitle(snapshot)

  return (
    <div className="space-y-3 rounded border p-3 text-sm">
      <div className="space-y-1">
        <p className="font-medium">{t('messages.objects.record', 'Linked record')}</p>
        <p className="text-xs text-muted-foreground" title={entityId}>
          {label}
        </p>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>

      {actionRequired ? (
        <p className="text-xs text-amber-700">
          {actionLabel
            ? t('messages.composer.objectAction', 'Action: {action}', { action: actionLabel })
            : t('messages.composer.objectActionRequired', 'Action required')}
        </p>
      ) : null}

      {actions.length ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.id}
              type="button"
              size="sm"
              variant={action.variant ?? 'default'}
              onClick={async () => {
                if (executingActionId) return
                setExecutingActionId(action.id)
                try {
                  await onAction(action.id)
                } finally {
                  setExecutingActionId(null)
                }
              }}
              disabled={executingActionId !== null}
            >
              {executingActionId === action.id
                ? t('messages.actions.executing', 'Executing...')
                : t(action.labelKey ?? action.id, action.labelKey ?? action.id)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default MessageRecordObjectDetail
