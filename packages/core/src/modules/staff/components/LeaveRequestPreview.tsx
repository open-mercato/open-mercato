"use client"

import type { ObjectPreviewProps } from '@open-mercato/shared/modules/messages/types'
import { CalendarClock } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'

export function LeaveRequestPreview({
  snapshot,
  previewData,
  actionRequired,
  actionLabel
}: ObjectPreviewProps) {
  // Use previewData if available, otherwise fall back to snapshot
  const data = snapshot as {
    employeeName?: string
    startDate?: string
    endDate?: string
    status?: string
    type?: string
  } | undefined

  const title = previewData?.title || 'Leave Request'
  const subtitle = previewData?.subtitle || (data ?
    `${data.employeeName} - ${data.startDate} to ${data.endDate}` :
    'Leave Request Details'
  )
  const status = previewData?.status || data?.status
  const statusColor = previewData?.statusColor || 'amber'

  return (
    <div className="flex items-start gap-3 rounded-md border p-3 bg-muted/30">
      <CalendarClock className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{title}</span>
          {actionRequired && (
            <Badge variant="secondary" className="text-xs">
              {actionLabel || 'Action Required'}
            </Badge>
          )}
        </div>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">
            {subtitle}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          {status && (
            <Badge variant="outline" className="text-xs">
              {status}
            </Badge>
          )}
          {data?.type && (
            <Badge variant="secondary" className="text-xs">
              {data.type}
            </Badge>
          )}
        </div>
        {previewData?.metadata && Object.keys(previewData.metadata).length > 0 && (
          <div className="mt-2 space-y-1">
            {Object.entries(previewData.metadata).slice(0, 3).map(([key, value]) => (
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

export default LeaveRequestPreview