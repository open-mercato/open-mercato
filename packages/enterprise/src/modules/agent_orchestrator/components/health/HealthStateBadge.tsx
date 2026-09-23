"use client"

import * as React from 'react'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { HealthState } from '../../lib/systemHealth'
import { HEALTH_STATE_FALLBACK, HEALTH_STATE_LABEL_KEY, HEALTH_STATE_VARIANT } from './vocabulary'

/**
 * The single rendering of a health state. `whitespace-nowrap` is not cosmetic:
 * at the panel's width "Not checked" used to wrap onto two lines and push the
 * adapter list into the label column.
 */
export function HealthStateBadge({ state }: { state: HealthState }) {
  const t = useT()
  return (
    <StatusBadge variant={HEALTH_STATE_VARIANT[state]} dot className="whitespace-nowrap">
      {t(HEALTH_STATE_LABEL_KEY[state], HEALTH_STATE_FALLBACK[state])}
    </StatusBadge>
  )
}
