"use client"

import { Building2, BriefcaseBusiness, UserRound } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ObjectPreviewProps } from '@open-mercato/shared/modules/messages/types'
import { Badge } from '@open-mercato/ui/primitives/badge'

export function CustomerMessageObjectPreview({
  entityType,
  entityId,
  previewData,
  actionRequired,
  actionLabel,
}: ObjectPreviewProps) {
  const t = useT()

  const isCompany = entityType === 'company'
  const isDeal = entityType === 'deal'
  const Icon = isDeal ? BriefcaseBusiness : isCompany ? Building2 : UserRound

  const fallbackTitle = isDeal
    ? t('customers.deals.list.title', 'Deals')
    : isCompany
      ? t('customers.companies.list.title', 'Companies')
      : t('customers.people.list.title', 'People')

  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/20 p-3">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{previewData?.title || fallbackTitle}</p>
          {actionRequired ? (
            <Badge variant="secondary" className="text-xs">
              {actionLabel || t('messages.composer.objectActionRequired', 'Action required')}
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{previewData?.subtitle || entityId}</p>
        {previewData?.status ? (
          <Badge variant="outline" className="text-xs">{previewData.status}</Badge>
        ) : null}
      </div>
    </div>
  )
}

export default CustomerMessageObjectPreview

