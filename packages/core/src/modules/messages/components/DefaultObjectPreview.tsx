"use client"

import type { ObjectPreviewProps } from '@open-mercato/shared/modules/messages/types'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { FileText } from 'lucide-react'

export function DefaultObjectPreview({
  entityModule,
  entityType,
  snapshot,
  previewData,
  actionRequired,
  actionLabel
}: ObjectPreviewProps) {
  const title = previewData?.title || entityType.replace(/_/g, ' ')
  const subtitle = previewData?.subtitle || `${entityModule}:${entityType}`
  const status = previewData?.status
  const statusColor = previewData?.statusColor || 'default'

  return (
    <div className="flex items-start gap-3 rounded-md border p-3 bg-muted/30">
      <FileText className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{title}</span>
          {actionRequired && (
            <Badge variant="secondary" className="text-xs">
              {actionLabel || 'Action Required'}
            </Badge>
          )}
          {status && (
            <Badge
              variant={statusColor === 'green' ? 'default' : 'outline'}
              className="text-xs"
            >
              {status}
            </Badge>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {subtitle}
          </p>
        )}
        {previewData?.metadata && Object.keys(previewData.metadata).length > 0 && (
          <div className="mt-2 space-y-1">
            {Object.entries(previewData.metadata).slice(0, 2).map(([key, value]) => (
              <div key={key} className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="font-medium">{key}:</span>
                <span className="truncate">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DefaultObjectPreview