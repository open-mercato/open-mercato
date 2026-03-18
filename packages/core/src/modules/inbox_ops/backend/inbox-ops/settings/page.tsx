"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ArrowLeft, Copy, CheckCircle } from 'lucide-react'

const LANGUAGE_KEYS = ['en', 'de', 'es', 'pl'] as const

export default function InboxSettingsPage() {
  const t = useT()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'inbox-ops-settings',
  })

  const languageOptions = LANGUAGE_KEYS.map((key) => ({
    value: key,
    label: t(`inbox_ops.settings.language_${key}` as never, key),
  }))
  const [settings, setSettings] = React.useState<{ inboxAddress?: string; isActive?: boolean; workingLanguage?: string } | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [isSavingLanguage, setIsSavingLanguage] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const result = await apiCall<{ settings: { inboxAddress?: string; isActive?: boolean; workingLanguage?: string } | null }>('/api/inbox_ops/settings')
        if (!cancelled) {
          if (result?.ok && result.result?.settings) {
            setSettings(result.result.settings)
          } else {
            setError(t('inbox_ops.settings.load_failed', 'Failed to load settings'))
          }
        }
      } catch {
        if (!cancelled) setError(t('inbox_ops.settings.load_failed', 'Failed to load settings'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [t])

  const handleCopy = React.useCallback(() => {
    if (settings?.inboxAddress) {
      navigator.clipboard.writeText(settings.inboxAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [settings])

  const handleLanguageChange = React.useCallback(async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const workingLanguage = event.target.value
    setIsSavingLanguage(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean; settings: { workingLanguage: string } }>('/api/inbox_ops/settings', {
        method: 'PATCH',
        body: JSON.stringify({ workingLanguage }),
      }),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      setSettings((prev) => prev ? { ...prev, workingLanguage: result.result!.settings.workingLanguage } : prev)
      flash(t('inbox_ops.settings.language_saved', 'Working language updated'), 'success')
    } else {
      flash(t('inbox_ops.settings.language_save_failed', 'Failed to update working language'), 'error')
    }
    setIsSavingLanguage(false)
  }, [t, runMutation])

  return (
    <Page>
      <div className="flex items-center gap-3 px-3 py-3 md:px-6 md:py-4">
        <Link href="/backend/inbox-ops">
          <Button type="button" variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-lg font-semibold">{t('inbox_ops.settings.title', 'Inbox Settings')}</h1>
      </div>

      <PageBody>
        <div className="max-w-lg">
          {isLoading ? (
            <LoadingMessage label={t('inbox_ops.settings.loading', 'Loading settings...')} />
          ) : error ? (
            <ErrorMessage label={error} />
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
                  <Button type="button" variant="outline" size="sm" className="h-11 md:h-9" onClick={handleCopy}>
                    {copied ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    <span className="ml-1">{copied ? t('inbox_ops.settings.copied', 'Copied') : t('inbox_ops.settings.copy', 'Copy')}</span>
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">{t('inbox_ops.settings.status', 'Status')}</label>
                <div className="mt-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    settings.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {settings.isActive ? t('inbox_ops.settings.active', 'Active') : t('inbox_ops.settings.inactive', 'Inactive')}
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor="working-language" className="text-sm font-medium text-foreground">
                  {t('inbox_ops.settings.working_language', 'Working Language')}
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('inbox_ops.settings.working_language_hint', 'AI summaries and action descriptions will be generated in this language')}
                </p>
                <select
                  id="working-language"
                  className="mt-2 block w-full sm:w-[200px] h-11 md:h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={settings.workingLanguage || 'en'}
                  onChange={handleLanguageChange}
                  disabled={isSavingLanguage}
                >
                  {languageOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('inbox_ops.settings.not_found', 'No inbox settings found. Settings are created when a new tenant is provisioned.')}</p>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
