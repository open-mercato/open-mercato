"use client"

import type { ObjectPreviewProps } from '@open-mercato/shared/modules/messages/types'
import { resolveMessageObjectPreviewComponent } from './typeUiRegistry'
import { DefaultObjectPreview } from './DefaultObjectPreview'

export type MessageObject = {
  id: string
  entityModule: string
  entityType: string
  entityId: string
  actionRequired: boolean
  actionType?: string | null
  actionLabel?: string | null
  snapshot?: Record<string, unknown> | null
}

export type MessageObjectsListProps = {
  objects: MessageObject[]
  compact?: boolean
  maxItems?: number
}

export function MessageObjectsList({ objects, compact = false, maxItems }: MessageObjectsListProps) {
  if (!objects.length) return null

  const displayObjects = maxItems ? objects.slice(0, maxItems) : objects
  const remainingCount = maxItems && objects.length > maxItems ? objects.length - maxItems : 0

  return (
    <div className={`space-y-2 ${compact ? 'space-y-1' : ''}`}>
      {displayObjects.map((obj) => {
        const PreviewComponent = resolveMessageObjectPreviewComponent(obj.entityModule, obj.entityType)
        const ComponentToUse = PreviewComponent || DefaultObjectPreview

        const props: ObjectPreviewProps = {
          entityId: obj.entityId,
          entityModule: obj.entityModule,
          entityType: obj.entityType,
          snapshot: obj.snapshot || undefined,
          actionRequired: obj.actionRequired,
          actionType: obj.actionType || undefined,
          actionLabel: obj.actionLabel || undefined,
        }

        return (
          <div
            key={obj.id}
            className={
              compact
                ? 'rounded-md bg-muted/20 p-1'
                : 'rounded-md'
            }
          >
            <ComponentToUse {...props} />
          </div>
        )
      })}
      {remainingCount > 0 && (
        <div className="text-xs text-muted-foreground px-3 py-1">
          +{remainingCount} more object{remainingCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}

export default MessageObjectsList
