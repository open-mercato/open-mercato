"use client"

import * as React from 'react'
import { Link2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ObjectDetailProps } from '@open-mercato/shared/modules/messages/types'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { getMessageObjectType } from '../../lib/message-objects-registry'

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
  entityModule,
  entityType,
  snapshot,
  previewData,
  actionRequired,
  actionLabel,
  actions,
  onAction,
}: ObjectDetailProps) {
  const t = useT()
  const [executingActionId, setExecutingActionId] = React.useState<string | null>(null)

  const registeredType = getMessageObjectType(entityModule, entityType)
  const fallbackTitle = t('messages.objectPreview.fallback.title', 'Linked object')
  const typeLabel = registeredType
    ? t(registeredType.labelKey, `${entityModule}:${entityType}`)
    : `${entityModule}:${entityType}`
  const title = previewData?.title || readSnapshotLabel(snapshot) || fallbackTitle
  const subtitle = previewData?.subtitle
    || readSnapshotSubtitle(snapshot)
    || t('messages.objectPreview.fallback.subtitle', '{type} • {id}', { type: typeLabel, id: entityId })

  return (
    <div className="space-y-3 rounded p-3 text-sm">
      <div className="flex items-start gap-3 rounded bg-muted/20 p-3">
        <Link2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{title}</p>
          <p className="text-xs text-muted-foreground" title={entityId}>{subtitle}</p>
          {previewData?.status ? (
            <Badge variant="outline" className="text-xs">{previewData.status}</Badge>
          ) : null}
        </div>
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
