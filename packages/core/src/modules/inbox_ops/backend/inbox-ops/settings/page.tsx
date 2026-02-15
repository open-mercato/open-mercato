"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ArrowLeft, Copy, CheckCircle } from 'lucide-react'

export default function InboxSettingsPage() {
  const t = useT()
  const [settings, setSettings] = React.useState<{ inboxAddress?: string; isActive?: boolean } | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    async function load() {
      setIsLoading(true)
      const result = await apiCall<{ settings: { inboxAddress?: string; isActive?: boolean } | null }>('/api/inbox_ops/settings')
      if (result?.ok && result.result?.settings) setSettings(result.result.settings)
      setIsLoading(false)
    }
    load()
  }, [])

  const handleCopy = React.useCallback(() => {
    if (settings?.inboxAddress) {
      navigator.clipboard.writeText(settings.inboxAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [settings])

  return (
    <Page>
      <div className="flex items-center gap-3 px-3 py-3 md:px-6 md:py-4">
        <Link href="/backend/inbox-ops">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-lg font-semibold">{t('inbox_ops.settings.title', 'Inbox Settings')}</h1>
      </div>

      <PageBody>
        <div className="max-w-lg">
          {isLoading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-muted rounded w-1/3" />
              <div className="h-12 bg-muted rounded" />
            </div>
          ) : settings ? (
            <div className="space-y-6">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {t('inbox_ops.settings.forwarding_address', 'Forwarding Address')}
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('inbox_ops.settings.forwarding_hint', 'Forward email threads to this address to create proposals')}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 bg-muted rounded-lg px-4 py-3">
                    <code className="text-sm font-mono">{settings.inboxAddress}</code>
                  </div>
                  <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={handleCopy}>
                    {copied ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    <span className="ml-1">{copied ? 'Copied' : 'Copy'}</span>
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Status</label>
                <div className="mt-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    settings.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {settings.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No inbox settings found. Settings are created when a new tenant is provisioned.</p>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
