"use client"

import { Box, type LucideIcon } from 'lucide-react'
import * as lucideIcons from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ObjectPreviewProps } from '@open-mercato/shared/modules/messages/types'
import { Badge } from '@open-mercato/ui/primitives/badge'

function resolveIcon(name: string | undefined): LucideIcon {
  if (!name) return Box
  const key = name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('') as keyof typeof lucideIcons
  const candidate = lucideIcons[key]
  if (typeof candidate === 'function' || (typeof candidate === 'object' && candidate !== null && '$$typeof' in candidate)) {
    return candidate as LucideIcon
  }
  return Box
}

export function MessageObjectPreview({
  previewData,
  actionRequired,
  actionLabel,
  icon,
}: ObjectPreviewProps) {
  const t = useT()
  const Icon = resolveIcon(icon)

  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/20 p-3">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{previewData?.title || ''}</p>
          {actionRequired ? (
            <Badge variant="secondary" className="text-xs">
              {actionLabel || t('messages.composer.objectActionRequired', 'Action required')}
            </Badge>
          ) : null}
        </div>
        {previewData?.subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{previewData.subtitle}</p>
        ) : null}
        {previewData?.status ? (
          <Badge variant="outline" className="text-xs">{previewData.status}</Badge>
        ) : null}
        {previewData?.metadata && Object.keys(previewData.metadata).length > 0 ? (
          <dl className="space-y-1 pt-1">
            {Object.entries(previewData.metadata).map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 text-xs text-muted-foreground">
                <dt className="font-medium capitalize">{key}:</dt>
                <dd className="truncate">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  )
}

export default MessageObjectPreview
