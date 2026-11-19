"use client"

import * as React from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type DnsConfigProps = {
  hostname: string | null
  cnameTarget: string | null
  aRecordTarget: string | null
  ownershipRecord?: { name: string; value: string } | null
  verificationExpiresAt?: string | null
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)

  const handleCopy = React.useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [value])

  return (
    <Button type="button" variant="ghost" size="sm" onClick={handleCopy} aria-label={label}>
      {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      <span className="ml-1.5 text-xs">
        {copied
          ? t('customer_accounts.domainMapping.copyTarget.copied', 'Copied')
          : t('customer_accounts.domainMapping.copyTarget', 'Copy')}
      </span>
    </Button>
  )
}

export function DefaultDnsConfig({ hostname, cnameTarget, aRecordTarget, ownershipRecord, verificationExpiresAt }: DnsConfigProps) {
  const t = useT()
  const exampleHost = hostname ?? t('customer_accounts.domainMapping.hostname.placeholder', 'e.g., shop.yourdomain.com')

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      {ownershipRecord ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            {t('customer_accounts.domainMapping.dns.txtInstruction', 'Add this TXT record to verify ownership of the domain.')}
          </p>
          <dl className="space-y-2 text-sm">
            <dt>{t('customer_accounts.domainMapping.dns.txtName', 'TXT record name')}</dt>
            <dd className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
              <code className="min-w-0 flex-1 break-all font-mono">{ownershipRecord.name}</code>
              <CopyButton value={ownershipRecord.name} label={t('customer_accounts.domainMapping.dns.copyTxtName', 'Copy TXT record name')} />
            </dd>
            <dt>{t('customer_accounts.domainMapping.dns.txtValue', 'TXT record value')}</dt>
            <dd className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
              <code className="min-w-0 flex-1 break-all font-mono">{ownershipRecord.value}</code>
              <CopyButton value={ownershipRecord.value} label={t('customer_accounts.domainMapping.dns.copyTxtValue', 'Copy TXT record value')} />
            </dd>
          </dl>
        </div>
      ) : null}
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          {t('customer_accounts.domainMapping.cnameInstruction', 'Add a CNAME record for {hostname} pointing to {target} in your DNS provider', {
            hostname: exampleHost,
            target: cnameTarget ?? '—',
          })}
        </p>
        {cnameTarget ? (
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <code className="flex-1 truncate font-mono text-sm">{cnameTarget}</code>
            <CopyButton value={cnameTarget} label={t('customer_accounts.domainMapping.copyTarget', 'Copy')} />
          </div>
        ) : null}
      </div>
      {aRecordTarget ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t('customer_accounts.domainMapping.aRecordInstruction', 'For an apex domain, add an A record for {hostname} pointing to {target}', {
              hostname: exampleHost,
              target: aRecordTarget,
            })}
          </p>
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
            <code className="flex-1 truncate font-mono text-sm">{aRecordTarget}</code>
            <CopyButton value={aRecordTarget} label={t('customer_accounts.domainMapping.copyTarget', 'Copy')} />
          </div>
        </div>
      ) : null}
      {verificationExpiresAt ? (
        <p className="text-xs text-muted-foreground">
          {t('customer_accounts.domainMapping.dns.verificationDeadline', 'Verify by {deadline}. If the request expires, register again to get a new TXT record.', {
            deadline: new Date(verificationExpiresAt).toLocaleString(),
          })}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('customer_accounts.domainMapping.propagationNote', 'DNS changes can take up to 48 hours to propagate. The system checks automatically — you\'ll be notified when it\'s ready.')}
        </p>
      )}
    </div>
  )
}

export default DefaultDnsConfig
