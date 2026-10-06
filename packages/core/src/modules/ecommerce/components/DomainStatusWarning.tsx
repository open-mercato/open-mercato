'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { describeDomainStatus, isServingStatus } from './storeDomains'

type DomainStatusWarningProps = {
  status: string
  hostname: string
  appearance?: 'alert' | 'inline'
}

export function DomainStatusWarning({ status, hostname, appearance = 'inline' }: DomainStatusWarningProps) {
  const t = useT()
  if (isServingStatus(status)) return null
  const described = describeDomainStatus(status)
  const statusLabel = described.key ? t(described.key, described.fallback) : described.fallback
  const message = t(
    'ecommerce.backend.store.domains.warning.notServing',
    'This domain is {status}. Only an active domain serves, so the store does not answer at {hostname} yet.',
    { status: statusLabel, hostname },
  )
  if (appearance === 'alert') {
    return (
      <Alert status="warning">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    )
  }
  return <p className="text-xs text-status-warning-text">{message}</p>
}
