"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { MessageDetail } from '../types'

export function MessageDetailMetaSection({ detail }: { detail: MessageDetail }) {
  const t = useT()

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {detail.externalEmail ? (
        <div className="space-y-1 rounded border p-3 text-sm">
          <p className="font-medium">{t('messages.externalEmail', 'External email')}</p>
          <p>{detail.externalEmail}</p>
        </div>
      ) : null}
    </div>
  )
}
