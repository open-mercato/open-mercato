"use client"

import type { ObjectPreviewProps } from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { CalendarClock } from 'lucide-react'

function statusVariant(statusColor: string | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (statusColor === 'green') return 'default'
  if (statusColor === 'red') return 'destructive'
  if (statusColor === 'amber') return 'secondary'
  return 'outline'
}

export function LeaveRequestPreview({
  previewData,
  actionRequired,
  actionLabel,
}: ObjectPreviewProps) {
  const t = useT()

  return (
    <div className="flex items-start gap-3 rounded border p-3 text-sm">
      <CalendarClock className="mt-0.5 h-5 w-5 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="font-medium">{previewData?.title ?? t('staff.messageObjects.leaveRequest', 'Leave request')}</p>
          {actionRequired ? (
            <Badge variant="secondary" className="text-xs">
              {actionLabel ?? t('messages.composer.objectActionRequired', 'Action required')}
            </Badge>
          ) : null}
        </div>
        {previewData?.subtitle ? (
          <p className="text-xs text-muted-foreground">{previewData.subtitle}</p>
        ) : null}
        {previewData?.status ? (
          <Badge variant={statusVariant(previewData.statusColor)} className="text-xs">
            {previewData.status}
          </Badge>
        ) : null}
      </div>
    </div>
  )
}

export default LeaveRequestPreview
