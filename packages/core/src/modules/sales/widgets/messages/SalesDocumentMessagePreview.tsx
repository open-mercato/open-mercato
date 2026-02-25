"use client"

import { FileText, ReceiptText } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ObjectPreviewProps } from '@open-mercato/shared/modules/messages/types'
import { Badge } from '@open-mercato/ui/primitives/badge'

export function SalesDocumentMessagePreview({
  entityType,
  entityId,
  previewData,
  actionRequired,
  actionLabel,
}: ObjectPreviewProps) {
  const t = useT()
  const isQuote = entityType === 'quote'
  const Icon = isQuote ? FileText : ReceiptText
  const fallbackTitle = isQuote
    ? t('sales.documents.detail.quote', 'Sales quote')
    : t('sales.documents.detail.order', 'Sales order')
  const title = previewData?.title || fallbackTitle
  const subtitle = previewData?.subtitle || entityId

  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/20 p-3">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{title}</p>
          {actionRequired ? (
            <Badge variant="secondary" className="text-xs">
              {actionLabel || t('messages.composer.objectActionRequired', 'Action required')}
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        {previewData?.status ? (
          <Badge variant="outline" className="text-xs">{previewData.status}</Badge>
        ) : null}
      </div>
    </div>
  )
}

export default SalesDocumentMessagePreview

