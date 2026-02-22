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
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="truncate font-medium text-sm">{title}</span>
          {subtitle && (
            <>
              <span className="text-muted-foreground text-xs">-</span>
              <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
            </>
          )}
          {actionRequired && (
            <Badge variant="secondary" className="h-5 text-[11px]">
              {actionLabel || 'Action Required'}
            </Badge>
          )}
          {status && (
            <Badge
              variant={statusColor === 'green' ? 'default' : 'outline'}
              className="h-5 text-[11px]"
            >
              {status}
            </Badge>
          )}
        </div>
        {previewData?.metadata && Object.keys(previewData.metadata).length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {Object.entries(previewData.metadata).slice(0, 2).map(([key, value]) => (
              <div key={key} className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
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
