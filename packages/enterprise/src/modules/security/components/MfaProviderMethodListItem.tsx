'use client'

import * as React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { MfaMethod } from '../types'

type MfaProviderMethodListItemProps = {
  method: MfaMethod
  deleting?: boolean
  onDelete: (method: MfaMethod) => void
}

function formatLastUsed(value: string | null, t: ReturnType<typeof useT>): string {
  if (!value) return t('security.profile.mfa.method.neverUsed', 'Never used')
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return t('security.profile.mfa.method.unknownTime', 'Unknown')
  }
  return formatDistanceToNow(parsed, { addSuffix: true })
}

export default function MfaProviderMethodListItem({
  method,
  deleting = false,
  onDelete,
}: MfaProviderMethodListItemProps) {
  const t = useT()

  return (
    <article className="flex items-start justify-between gap-3 rounded-md border p-4">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium">
          {method.label ?? method.type}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t('security.profile.mfa.method.type', 'Type')}: {method.type}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t('security.profile.mfa.method.lastUsed', 'Last used')}: {formatLastUsed(method.lastUsedAt, t)}
        </p>
      </div>
      <IconButton
        type="button"
        variant="outline"
        size="sm"
        disabled={deleting}
        aria-label={t('ui.actions.delete', 'Delete')}
        title={t('ui.actions.delete', 'Delete')}
        onClick={() => onDelete(method)}
      >
        <Trash2 className="size-4" />
      </IconButton>
    </article>
  )
}
