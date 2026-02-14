"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ObjectPreviewProps } from '@open-mercato/shared/modules/messages/types'

function readSnapshotValue(snapshot: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!snapshot) return null
  for (const key of keys) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

export function MessageRecordObjectPreview({
  entityModule,
  entityType,
  entityId,
  snapshot,
  previewData,
  actionRequired,
  actionLabel,
}: ObjectPreviewProps) {
  const t = useT()

  const fallbackTitle = readSnapshotValue(snapshot, ['subject', 'title', 'name', 'label'])
    ?? `${entityModule}:${entityType}`
  const fallbackSubtitle = readSnapshotValue(snapshot, ['status', 'type'])

  return (
    <div className="space-y-2 rounded border p-3 text-sm">
      <div className="space-y-1">
        <p className="font-medium">{previewData?.title ?? fallbackTitle}</p>
        {previewData?.subtitle || fallbackSubtitle ? (
          <p className="text-xs text-muted-foreground">{previewData?.subtitle ?? fallbackSubtitle}</p>
        ) : null}
        {previewData?.status ? (
          <p className="text-xs text-muted-foreground">{previewData.status}</p>
        ) : null}
        <p className="text-xs text-muted-foreground" title={entityId}>{entityId}</p>
      </div>

      {actionRequired ? (
        <p className="text-xs text-amber-700">
          {actionLabel
            ? t('messages.composer.objectAction', 'Action: {action}', { action: actionLabel })
            : t('messages.composer.objectActionRequired', 'Action required')}
        </p>
      ) : null}
    </div>
  )
}

export default MessageRecordObjectPreview
