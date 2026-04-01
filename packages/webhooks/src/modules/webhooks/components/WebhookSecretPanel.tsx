"use client"

import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type WebhookSecretPanelProps = {
  secret: string
  onClose?: () => void
}

export function WebhookSecretPanel({ secret, onClose }: WebhookSecretPanelProps) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)

  async function handleCopySecret() {
    await navigator.clipboard.writeText(secret)
    setCopied(true)
    flash(t('webhooks.form.secretCopied'), 'success')
  }

  React.useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const CopyIcon = copied ? Check : Copy

  return (
    <div className="mx-auto w-full max-w-3xl rounded-xl border bg-card shadow-sm">
      <div className="border-b p-6">
        <h1 className="text-lg font-semibold leading-7">{t('webhooks.form.secret')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('webhooks.form.secretVisibleOnce')}</p>
      </div>
      <div className="space-y-4 p-6">
        <Notice variant="warning" compact>
          {t('webhooks.form.secretUsageTip')}
        </Notice>
        <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-4">
          <div className="min-w-0 flex-1 font-mono text-sm break-all">
            {secret}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={t('webhooks.form.secretCopy')}
            title={t('webhooks.form.secretCopy')}
            onClick={() => { void handleCopySecret() }}
          >
            <CopyIcon className={`h-4 w-4 ${copied ? 'text-green-600' : ''}`} />
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Notice compact>{t('webhooks.form.secretVerificationTip')}</Notice>
          <Notice compact>{t('webhooks.form.secretRotationTip')}</Notice>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => { void handleCopySecret() }}>
            <CopyIcon className={`mr-2 h-4 w-4 ${copied ? 'text-green-600' : ''}`} />
            {t('webhooks.form.secretCopy')}
          </Button>
          {onClose ? (
            <Button type="button" onClick={onClose}>
              {t('common.close')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default WebhookSecretPanel
