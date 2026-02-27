"use client"

import { Link2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ObjectPreviewProps } from '@open-mercato/shared/modules/messages/types'
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

export function MessageRecordObjectPreview({
  entityId,
  entityModule,
  entityType,
  snapshot,
  previewData,
  actionRequired,
  actionLabel,
}: ObjectPreviewProps) {
  const t = useT()
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
    <div className="flex items-start gap-3 rounded bg-muted/20 p-3">
      <Link2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm">{title}</p>
          {actionRequired ? (
            <Badge variant="secondary" className="text-xs">
              {actionLabel || t('messages.composer.objectActionRequired', 'Action required')}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground" title={entityId}>{subtitle}</p>
        {previewData?.status ? (
          <Badge variant="outline" className="text-xs">{previewData.status}</Badge>
        ) : null}
      </div>
    </div>
  )
}

export default MessageRecordObjectPreview
