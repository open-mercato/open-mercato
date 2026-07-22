'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'

export type EudrProductColumnValue = {
  commodity?: string | null
  isInScope?: boolean | null
} | null | undefined

export default function EudrProductColumnWidget({ value }: { value: EudrProductColumnValue }) {
  const t = useT()

  if (!value || typeof value.commodity !== 'string' || value.commodity.length === 0) {
    return (
      <span className="text-muted-foreground" aria-label={t('eudr.productColumn.noMapping')}>
        —
      </span>
    )
  }

  const inScope = value.isInScope !== false

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Tag variant={inScope ? 'success' : 'neutral'}>
        {t(`eudr.commodity.${value.commodity}`)}
      </Tag>
      {!inScope ? (
        <span className="text-xs text-muted-foreground">
          {t('eudr.productColumn.outOfScope')}
        </span>
      ) : null}
    </span>
  )
}
