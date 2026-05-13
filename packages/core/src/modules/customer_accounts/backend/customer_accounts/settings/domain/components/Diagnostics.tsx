"use client"

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DomainMappingRow } from './types'

export type DiagnosticsProps = {
  mapping: DomainMappingRow
}

export function DnsDiagnostics({ mapping }: DiagnosticsProps) {
  const t = useT()
  if (mapping.status !== 'dns_failed') return null
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" aria-hidden />
      <AlertTitle>
        {t('customer_accounts.domainMapping.dns.diagnostics.title', 'DNS configuration issue')}
      </AlertTitle>
      <AlertDescription>
        <div className="space-y-2">
          {mapping.dnsFailureReason ? <p>{mapping.dnsFailureReason}</p> : null}
          {mapping.cnameTarget ? (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">
                {t('customer_accounts.domainMapping.dns.diagnostics.expected', 'Expected target')}
              </dt>
              <dd className="font-mono">{mapping.cnameTarget}</dd>
            </dl>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  )
}

export function TlsDiagnostics({ mapping }: DiagnosticsProps) {
  const t = useT()
  if (mapping.status !== 'tls_failed') return null
  return (
    <Alert variant="warning">
      <AlertTriangle className="h-4 w-4" aria-hidden />
      <AlertTitle>
        {t('customer_accounts.domainMapping.tls.diagnostics.title', 'SSL certificate issue')}
      </AlertTitle>
      <AlertDescription>
        <div className="space-y-2">
          {mapping.tlsFailureReason ? <p>{mapping.tlsFailureReason}</p> : null}
          <p className="text-xs text-muted-foreground">
            {t('customer_accounts.domainMapping.tls.diagnostics.retryCount', 'Retry attempts: {count}', {
              count: String(mapping.tlsRetryCount),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              'customer_accounts.domainMapping.tls.diagnostics.operatorNote',
              'We are retrying automatically. If this persists, contact platform support — your DNS is fine, this is on our side.',
            )}
          </p>
        </div>
      </AlertDescription>
    </Alert>
  )
}
