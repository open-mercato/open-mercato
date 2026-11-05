"use client"

import * as React from 'react'
import { ExternalLink, RefreshCw, Replace, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DomainMappingRow } from './types'

export type ActionsProps = {
  mapping: DomainMappingRow
  isReplacement: boolean
  onCheckNow: () => void
  onRetryTls: () => void
  onChangeDomain: () => void
  onRemove: () => void
  busy?: boolean
}

export function DefaultActions({
  mapping,
  isReplacement,
  onCheckNow,
  onRetryTls,
  onChangeDomain,
  onRemove,
  busy,
}: ActionsProps) {
  const t = useT()
  const showCheckNow = mapping.status === 'pending' || mapping.status === 'dns_failed'
  const showRetryTls = mapping.status === 'tls_failed' || mapping.status === 'verified'
  const showTestDomain = mapping.status === 'active'
  const showChangeDomain = mapping.status === 'active' && !isReplacement

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showCheckNow ? (
        <Button type="button" variant="outline" size="sm" onClick={onCheckNow} disabled={busy}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />
          {t('customer_accounts.domainMapping.verifyNow', 'Check Now')}
        </Button>
      ) : null}
      {showRetryTls ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetryTls} disabled={busy}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />
          {t('customer_accounts.domainMapping.tls.retryButton', 'Retry SSL')}
        </Button>
      ) : null}
      {showTestDomain ? (
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={`https://${mapping.hostname}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden />
            {t('customer_accounts.domainMapping.preview', 'Test Domain')}
          </a>
        </Button>
      ) : null}
      {showChangeDomain ? (
        <Button type="button" variant="outline" size="sm" onClick={onChangeDomain} disabled={busy}>
          <Replace className="mr-1.5 h-4 w-4" aria-hidden />
          {t('customer_accounts.domainMapping.changeDomain', 'Change Domain')}
        </Button>
      ) : null}
      <Button type="button" variant="outline" size="sm" onClick={onRemove} disabled={busy}>
        <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
        {t('customer_accounts.domainMapping.removeDomain', 'Remove Domain')}
      </Button>
    </div>
  )
}

export default DefaultActions
