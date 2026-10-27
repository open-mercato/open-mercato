'use client'

import { useMemo } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import '../../lib/activity-registry-bootstrap'
import { listActivityTypes } from '../../lib/activity-registry'

export interface ActivityTypeOption {
  value: string
  label: string
}

export function useActivityTypeOptions(): ActivityTypeOption[] {
  const t = useT()
  return useMemo(
    () => listActivityTypes().map((entry) => ({ value: entry.id, label: t(entry.i18nKey) })),
    [t]
  )
}
