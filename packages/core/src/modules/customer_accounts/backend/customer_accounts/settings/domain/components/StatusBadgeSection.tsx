"use client"

import * as React from 'react'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { domainStatusMap } from './domainStatusMap'
import type { DomainMappingRow } from './types'

export type StatusBadgeSectionProps = {
  mapping: DomainMappingRow
}

function formatTime(value: string | null, fallback: string, locale: string): string {
  return formatDisplayDateTime(value, locale) ?? fallback
}

export function DefaultStatusBadge({ mapping }: StatusBadgeSectionProps) {
  const t = useT()
  const locale = useLocale()
  const variant = domainStatusMap[mapping.status]
  const label = t(
    `customer_accounts.domainMapping.status.${mapping.status}`,
    mapping.status,
  )
  const lastChecked = formatTime(
    mapping.lastDnsCheckAt,
    t('customer_accounts.domainMapping.autoVerify.checking', 'Automatically checking every 5 minutes'),
    locale,
  )
  const showAutoCheck = mapping.status === 'pending' || mapping.status === 'dns_failed'

  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusBadge variant={variant} dot>
        {label}
      </StatusBadge>
      {mapping.lastDnsCheckAt ? (
        <span className="text-xs text-muted-foreground">
          {t('customer_accounts.domainMapping.autoVerify.lastChecked', 'Last checked: {time}', {
            time: lastChecked,
          })}
        </span>
      ) : null}
      {showAutoCheck ? (
        <span className="text-xs text-muted-foreground">
          {t('customer_accounts.domainMapping.autoVerify.nextCheck', 'Next check in ~{minutes} minutes', {
            minutes: '5',
          })}
        </span>
      ) : null}
    </div>
  )
}

export default DefaultStatusBadge
