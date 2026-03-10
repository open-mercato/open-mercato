"use client"
import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CredentialFieldType, IntegrationCredentialField } from '@open-mercato/shared/modules/integrations/types'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'

type CredentialField = IntegrationCredentialField

const UNSUPPORTED_CREDENTIAL_FIELD_TYPES = new Set<CredentialFieldType>(['oauth', 'ssh_keypair'])

function isEditableCredentialField(field: CredentialField): boolean {
  return !UNSUPPORTED_CREDENTIAL_FIELD_TYPES.has(field.type)
}

type BundleIntegration = {
  id: string
  title: string
  description?: string
  category?: string
  isEnabled: boolean
}

type BundleDetail = {
  integration: {
    id: string
    title: string
    description?: string
    bundleId?: string
  }
  bundle?: {
    id: string
    title: string
    description?: string
    credentials?: { fields: CredentialField[] }
  }
  bundleIntegrations: BundleIntegration[]
  state: { isEnabled: boolean }
  hasCredentials: boolean
}

type BundleConfigPageProps = {
  params?: {
    id?: string | string[]
  }
}

function resolveRouteId(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function resolvePathnameId(pathname: string): string | undefined {
  const parts = pathname.split('/').filter(Boolean)
  const bundleId = parts.at(-1)
  if (!bundleId || bundleId === 'bundle' || bundleId === 'integrations') return undefined
  return decodeURIComponent(bundleId)
}

export default function BundleConfigPage({ params }: BundleConfigPageProps) {
  const pathname = usePathname()
  const bundleId = resolveRouteId(params?.id) ?? resolvePathnameId(pathname)
  const t = useT()

  const [detail, setDetail] = React.useState<BundleDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [credValues, setCredValues] = React.useState<Record<string, unknown>>({})
  const [isSavingCreds, setIsSavingCreds] = React.useState(false)
  const [togglingIds, setTogglingIds] = React.useState<Set<string>>(new Set())

  const resolveCurrentBundleId = React.useCallback(() => {
    return bundleId ?? (
      typeof window !== 'undefined'
        ? resolvePathnameId(window.location.pathname)
        : undefined
    )
  }, [bundleId])

  const load = React.useCallback(async () => {
    const currentBundleId = resolveCurrentBundleId()
    if (!currentBundleId) {
      setError(t('integrations.detail.loadError'))
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    const call = await apiCall<BundleDetail>(
      `/api/integrations/${encodeURIComponent(currentBundleId)}`,
      undefined,
      { fallback: null },
    )
    if (!call.ok || !call.result) {
      setError(t('integrations.detail.loadError'))
      setIsLoading(false)
      return
    }
    setDetail(call.result)

    const credCall = await apiCall<{ credentials: Record<string, unknown> }>(
      `/api/integrations/${encodeURIComponent(currentBundleId)}/credentials`,
      undefined,
      { fallback: null },
    )
    if (credCall.ok && credCall.result?.credentials) {
      setCredValues(credCall.result.credentials)
    }
    setIsLoading(false)
  }, [resolveCurrentBundleId, t])

  React.useEffect(() => { void load() }, [load])

  const handleSaveCredentials = React.useCallback(async () => {
    const currentBundleId = resolveCurrentBundleId()
    if (!currentBundleId) return
    setIsSavingCreds(true)
    const call = await apiCall(`/api/integrations/${encodeURIComponent(currentBundleId)}/credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials: credValues }),
    }, { fallback: null })
    if (call.ok) {
      flash(t('integrations.detail.credentials.saved'), 'success')
    } else {
      flash(t('integrations.detail.credentials.saveError'), 'error')
    }
    setIsSavingCreds(false)
  }, [resolveCurrentBundleId, credValues, t])

  const handleToggle = React.useCallback(async (integrationId: string, enabled: boolean) => {
    setTogglingIds((prev) => new Set(prev).add(integrationId))
    const call = await apiCall(`/api/integrations/${encodeURIComponent(integrationId)}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled: enabled }),
    }, { fallback: null })
    if (call.ok) {
      setDetail((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          bundleIntegrations: prev.bundleIntegrations.map((item) =>
            item.id === integrationId ? { ...item, isEnabled: enabled } : item,
          ),
        }
      })
    } else {
      flash(t('integrations.detail.stateError'), 'error')
    }
    setTogglingIds((prev) => { const next = new Set(prev); next.delete(integrationId); return next })
  }, [t])

  const handleBulkToggle = React.useCallback(async (enabled: boolean) => {
    if (!detail) return
    const targets = detail.bundleIntegrations.filter((item) => item.isEnabled !== enabled)
    await Promise.all(targets.map((item) => handleToggle(item.id, enabled)))
  }, [detail, handleToggle])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('integrations.bundle.title')} /></PageBody></Page>
  if (error || !detail?.bundle) return <Page><PageBody><ErrorMessage label={error ?? t('integrations.detail.loadError')} /></PageBody></Page>

  const credFields = (detail.bundle.credentials?.fields ?? []).filter(isEditableCredentialField)

  return (
    <Page>
      <PageBody className="space-y-6">
        <div>
          <Link href="/backend/integrations" className="text-sm text-muted-foreground hover:underline">
            {t('integrations.detail.back')}
          </Link>
        </div>

        <div>
          <h1 className="text-2xl font-semibold">{detail.bundle.title}</h1>
          {detail.bundle.description && (
            <p className="text-muted-foreground mt-1">{detail.bundle.description}</p>
          )}
        </div>

        {credFields.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('integrations.bundle.sharedCredentials')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {credFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  {field.type === 'select' && field.options ? (
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      value={(credValues[field.key] as string) ?? ''}
                      onChange={(e) => setCredValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    >
                      <option value="">—</option>
                      {field.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : field.type === 'boolean' ? (
                    <Switch
                      checked={Boolean(credValues[field.key])}
                      onCheckedChange={(checked) => setCredValues((prev) => ({ ...prev, [field.key]: checked }))}
                    />
                  ) : (
                    <Input
                      type={field.type === 'secret' ? 'password' : 'text'}
                      placeholder={field.placeholder}
                      value={(credValues[field.key] as string) ?? ''}
                      onChange={(e) => setCredValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
              <Button type="button" onClick={() => void handleSaveCredentials()} disabled={isSavingCreds}>
                {isSavingCreds ? <Spinner className="mr-2 h-4 w-4" /> : null}
                {t('integrations.detail.credentials.save')}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t('integrations.bundle.integrationToggles')}</CardTitle>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void handleBulkToggle(true)}>
                  {t('integrations.marketplace.enableAll')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleBulkToggle(false)}>
                  {t('integrations.marketplace.disableAll')}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {detail.bundleIntegrations.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Link
                      href={`/backend/integrations/${encodeURIComponent(item.id)}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                    {item.category && (
                      <Badge variant="secondary" className="ml-2 text-xs">{item.category}</Badge>
                    )}
                    {item.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/backend/integrations/${encodeURIComponent(item.id)}`}>
                        {t('integrations.bundle.configureIntegration')}
                      </Link>
                    </Button>
                    <Switch
                      checked={item.isEnabled}
                      disabled={togglingIds.has(item.id)}
                      onCheckedChange={(checked) => void handleToggle(item.id, checked)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </Page>
  )
}
