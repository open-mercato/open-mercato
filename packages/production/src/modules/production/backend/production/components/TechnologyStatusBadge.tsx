'use client'

import * as React from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'

export type TechnologyStatus = 'draft' | 'active' | 'archived'

type Translate = (key: string, fallback?: string) => string

const VARIANT_BY_STATUS: Record<TechnologyStatus, 'neutral' | 'success' | 'muted'> = {
  draft: 'neutral',
  active: 'success',
  archived: 'muted',
}

/** Status pill shared by BOM and routing list/edit pages (task 1.3). */
export function TechnologyStatusBadge({ status, t }: { status: TechnologyStatus; t: Translate }) {
  return (
    <Badge variant={VARIANT_BY_STATUS[status] ?? 'neutral'}>
      {t(`production.status.${status}`, status)}
    </Badge>
  )
}
