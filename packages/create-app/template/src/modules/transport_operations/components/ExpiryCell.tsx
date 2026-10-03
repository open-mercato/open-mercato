"use client"

import * as React from 'react'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveExpiryState, type ExpiryState } from '../lib/expiry'

const EXPIRY_CLASSES: Record<ExpiryState, string> = {
  expired: 'border-status-error-border bg-status-error-bg text-status-error-text',
  expiring: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
  valid: 'border-status-success-border bg-status-success-bg text-status-success-text',
  unknown: 'border-border bg-muted text-muted-foreground',
}

const EXPIRY_FALLBACKS: Record<ExpiryState, string> = {
  expired: 'Expired',
  expiring: 'Expiring soon',
  valid: 'Valid',
  unknown: 'No date',
}

/**
 * A licence date with its state.
 *
 * The date is rendered next to the badge because "Expiring soon" without a date cannot be acted on,
 * and a missing date reads as `unknown` rather than as valid: a driver whose licence has no recorded
 * expiry is not provably allowed to drive, and dispatch refuses the assignment.
 */
export function ExpiryCell({ value }: { value: string | null | undefined }) {
  const t = useT()
  const locale = useLocale()
  const state = resolveExpiryState(value)
  return (
    <span className="flex items-center gap-2">
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${EXPIRY_CLASSES[state]}`}>
        {t(`transport_operations.expiry.state.${state}`, EXPIRY_FALLBACKS[state])}
      </span>
      <span className="text-xs text-muted-foreground">{formatDate(value, locale) ?? '—'}</span>
    </span>
  )
}
