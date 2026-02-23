'use client'

import React from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Tab = 'general' | 'domains' | 'activity'

interface SsoConfigDetail {
  id: string
  name: string | null
  tenantId: string | null
  organizationId: string
  protocol: string
  issuer: string | null
  clientId: string | null
  hasClientSecret: boolean
  allowedDomains: string[]
  jitEnabled: boolean
  autoLinkByEmail: boolean
  isActive: boolean
  ssoRequired: boolean
  defaultRoleId: string | null
  createdAt: string
  updatedAt: string
}

interface SsoIdentityRow {
  id: string
  userId: string
  idpEmail: string
  idpName: string | null
  provisioningMethod: string
  lastLoginAt: string | null
  createdAt: string
}

export default function SsoConfigDetailPage() {
  const params = useParams()
  const configId = (params?.slug && Array.isArray(params.slug))
    ? params.slug[2]
    : (Array.isArray(params?.id) ? params.id[0] : params?.id as string)
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [config, setConfig] = React.useState<SsoConfigDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<Tab>('general')
  const [showActivationBanner, setShowActivationBanner] = React.useState(searchParams?.get('created') === '1')
  const [activationError, setActivationError] = React.useState<string | null>(null)
  const [isActivating, setIsActivating] = React.useState(false)

  // General tab form state
  const [name, setName] = React.useState('')
  const [issuer, setIssuer] = React.useState('')
  const [clientId, setClientId] = React.useState('')
  const [newClientSecret, setNewClientSecret] = React.useState('')
  const [showSecretField, setShowSecretField] = React.useState(false)
  const [jitEnabled, setJitEnabled] = React.useState(true)
  const [autoLinkByEmail, setAutoLinkByEmail] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  // Domains tab state
  const [domainInput, setDomainInput] = React.useState('')
  const [domainError, setDomainError] = React.useState('')

  const fetchConfig = React.useCallback(async () => {
    setIsLoading(true)
    const call = await apiCall<SsoConfigDetail>(`/api/sso/config/${configId}`)
    if (call.ok && call.result) {
      const c = call.result
      setConfig(c)
      setName(c.name ?? '')
      setIssuer(c.issuer ?? '')
      setClientId(c.clientId ?? '')
      setJitEnabled(c.jitEnabled)
      setAutoLinkByEmail(c.autoLinkByEmail)
      setError(null)
    } else {
      setError(t('sso.admin.error.loadFailed', 'Failed to load SSO configuration'))
    }
    setIsLoading(false)
  }, [configId, t])

  React.useEffect(() => { fetchConfig() }, [fetchConfig])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload: Record<string, unknown> = { name, issuer, clientId, jitEnabled, autoLinkByEmail }
      if (newClientSecret) payload.clientSecret = newClientSecret

      await apiCallOrThrow<SsoConfigDetail>(
        `/api/sso/config/${configId}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
        { errorMessage: t('sso.admin.error.saveFailed', 'Failed to save SSO configuration') },
      )
      flash(t('sso.admin.saved', 'SSO configuration saved'), 'success')
      setNewClientSecret('')
      setShowSecretField(false)
      fetchConfig()
    } catch {
      // apiCallOrThrow handles the error
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleActivation = async () => {
    if (!config) return
    setActivationError(null)
    setIsActivating(true)
    try {
      await apiCallOrThrow(
        `/api/sso/config/${configId}/activate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ active: !config.isActive }),
        },
        { errorMessage: t('sso.admin.error.activationFailed', 'Failed to update activation status') },
      )
      flash(
        config.isActive
          ? t('sso.admin.deactivated', 'SSO configuration deactivated')
          : t('sso.admin.activated', 'SSO configuration activated'),
        'success',
      )
      setShowActivationBanner(false)
      fetchConfig()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isNoDomains = message.toLowerCase().includes('no allowed domains')
      if (isNoDomains) {
        setActivationError(t('sso.admin.error.noDomainsForActivation', 'Add at least one allowed email domain before activating'))
        setActiveTab('domains')
      } else {
        setActivationError(message)
      }
    } finally {
      setIsActivating(false)
    }
  }

  const handleTestConnection = async () => {
    try {
      const call = await apiCallOrThrow<{ ok: boolean; error?: string }>(
        `/api/sso/config/${configId}/test`,
        { method: 'POST' },
        { errorMessage: t('sso.admin.error.testFailed', 'Connection test failed') },
      )
      if (call.result?.ok) {
        flash(t('sso.admin.test.success', 'Discovery successful — issuer is reachable'), 'success')
      } else {
        flash(call.result?.error || t('sso.admin.test.failed', 'Discovery failed'), 'error')
      }
    } catch {
      // handled by apiCallOrThrow
    }
  }

  const handleDelete = async () => {
    if (!config) return
    if (config.isActive) {
      flash(t('sso.admin.error.deleteActive', 'Cannot delete an active SSO configuration — deactivate it first'), 'error')
      return
    }
    const confirmed = await confirm({
      title: t('sso.admin.delete.title', 'Delete SSO Configuration'),
      text: t('sso.admin.delete.confirm', 'Are you sure? This will remove the SSO configuration.'),
      confirmText: t('common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (!confirmed) return

    await apiCallOrThrow(`/api/sso/config/${configId}`, { method: 'DELETE' }, {
      errorMessage: t('sso.admin.error.deleteFailed', 'Failed to delete SSO configuration'),
    })
    flash(t('sso.admin.delete.success', 'SSO configuration deleted'), 'success')
    router.push('/backend/sso')
  }

  const handleAddDomain = async () => {
    const normalized = domainInput.trim().toLowerCase()
    if (!normalized) return

    const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/
    if (!domainRegex.test(normalized) || !normalized.includes('.')) {
      setDomainError(t('sso.admin.wizard.domain.invalid', 'Invalid domain format'))
      return
    }

    try {
      await apiCallOrThrow(
        `/api/sso/config/${configId}/domains`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ domain: normalized }),
        },
        { errorMessage: t('sso.admin.error.domainAddFailed', 'Failed to add domain') },
      )
      setDomainInput('')
      setDomainError('')
      fetchConfig()
    } catch {
      // handled by apiCallOrThrow
    }
  }

  const handleRemoveDomain = async (domain: string) => {
    try {
      await apiCallOrThrow(
        `/api/sso/config/${configId}/domains?domain=${encodeURIComponent(domain)}`,
        { method: 'DELETE' },
        { errorMessage: t('sso.admin.error.domainRemoveFailed', 'Failed to remove domain') },
      )
      fetchConfig()
    } catch {
      // handled by apiCallOrThrow
    }
  }

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('common.loading', 'Loading...')} /></PageBody></Page>
  if (error || !config) return <Page><PageBody><ErrorMessage label={error || t('common.notFound', 'Not found')} /></PageBody></Page>

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: t('sso.admin.tab.general', 'General') },
    { id: 'domains', label: t('sso.admin.tab.domains', 'Domains') },
    { id: 'activity', label: t('sso.admin.tab.activity', 'Activity') },
  ]

  return (
    <Page>
      <PageBody>
        <div className="max-w-3xl">
          {/* Activation banner after creation */}
          {showActivationBanner && !config.isActive && (
            <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-medium text-blue-900 mb-3">
                {t('sso.admin.banner.created', 'Your SSO configuration has been created. Would you like to activate it now?')}
              </p>
              {activationError && (
                <p className="text-sm text-destructive mb-3">{activationError}</p>
              )}
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleToggleActivation} disabled={isActivating}>
                  {isActivating
                    ? t('common.activating', 'Activating...')
                    : t('sso.admin.banner.activateNow', 'Activate Now')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowActivationBanner(false)}>
                  {t('sso.admin.banner.notYet', 'Not Yet')}
                </Button>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold">{config.name || config.issuer || t('sso.admin.detail.title', 'SSO Configuration')}</h1>
              <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium mt-1 ${config.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                {config.isActive ? t('sso.admin.status.active', 'Active') : t('sso.admin.status.inactive', 'Inactive')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleTestConnection}>
                {t('sso.admin.action.test', 'Verify Discovery')}
              </Button>
              <Button
                variant={config.isActive ? 'outline' : 'default'}
                size="sm"
                onClick={handleToggleActivation}
              >
                {config.isActive
                  ? t('sso.admin.action.deactivate', 'Deactivate')
                  : t('sso.admin.action.activate', 'Activate')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDelete} className="text-destructive">
                {t('common.delete', 'Delete')}
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b mb-6">
            {tabs.map((tab) => (
              <Button
                key={tab.id}
                type="button"
                variant="ghost"
                size="sm"
                className={`h-auto rounded-none border-b-2 px-4 py-2 hover:bg-transparent ${
                  activeTab === tab.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('sso.admin.field.name', 'Configuration Name')}</label>
                <input
                  type="text"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('sso.admin.field.protocol', 'Protocol')}</label>
                <input type="text" className="w-full rounded-md border px-3 py-2 text-sm bg-muted" value={config.protocol.toUpperCase()} disabled />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('sso.admin.field.issuer', 'Issuer URL')}</label>
                <input
                  type="url"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('sso.admin.field.clientId', 'Client ID')}</label>
                <input
                  type="text"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('sso.admin.field.clientSecret', 'Client Secret')}</label>
                {config.hasClientSecret && !showSecretField ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{t('sso.admin.field.secretSet', 'Client secret is configured')}</span>
                    <Button variant="outline" size="sm" onClick={() => setShowSecretField(true)}>
                      {t('sso.admin.field.changeSecret', 'Change')}
                    </Button>
                  </div>
                ) : (
                  <input
                    type="password"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={newClientSecret}
                    onChange={(e) => setNewClientSecret(e.target.value)}
                    placeholder={config.hasClientSecret
                      ? t('sso.admin.field.secretPlaceholder', 'Enter new secret to replace existing')
                      : t('sso.admin.field.secretRequired', 'Enter client secret')}
                  />
                )}
              </div>
              <div className="space-y-3 pt-2">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={jitEnabled}
                    onChange={(e) => setJitEnabled(e.target.checked)}
                    className="accent-primary"
                  />
                  <div>
                    <span className="text-sm font-medium">{t('sso.admin.field.jitEnabled', 'Just-in-Time Provisioning')}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {t('sso.admin.field.jitEnabledDesc', 'Automatically create user accounts on first SSO login')}
                    </span>
                  </div>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={autoLinkByEmail}
                    onChange={(e) => setAutoLinkByEmail(e.target.checked)}
                    className="accent-primary"
                  />
                  <div>
                    <span className="text-sm font-medium">{t('sso.admin.field.autoLinkByEmail', 'Auto-link by Email')}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {t('sso.admin.field.autoLinkByEmailDesc', 'Automatically link existing users by matching email address')}
                    </span>
                  </div>
                </label>
              </div>
              <div className="pt-4">
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
                </Button>
              </div>
            </div>
          )}

          {activeTab === 'domains' && (
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                {t('sso.admin.wizard.domains.description', 'Users with email addresses matching these domains will be redirected to your SSO provider.')}
              </p>
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="text"
                  className="flex-1 rounded-md border px-3 py-2 text-sm"
                  placeholder={t('sso.admin.wizard.domains.placeholder', 'example.com')}
                  value={domainInput}
                  onChange={(e) => { setDomainInput(e.target.value); setDomainError('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddDomain() } }}
                />
                <Button variant="outline" onClick={handleAddDomain}>
                  {t('common.add', 'Add')}
                </Button>
              </div>
              {domainError && <p className="text-sm text-destructive mb-2">{domainError}</p>}
              {config.allowedDomains.length > 0 ? (
                <div className="space-y-2">
                  {config.allowedDomains.map((domain) => (
                    <div key={domain} className="flex items-center justify-between p-3 border rounded-md">
                      <code className="text-sm font-mono">{domain}</code>
                      <Button variant="ghost" size="sm" onClick={() => handleRemoveDomain(domain)}>
                        {t('common.remove', 'Remove')}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t('sso.admin.domains.empty', 'No domains configured. Add at least one domain before activating SSO.')}
                </p>
              )}
            </div>
          )}

          {activeTab === 'activity' && (
            <SsoActivityTab configId={configId} />
          )}
        </div>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

function SsoActivityTab({ configId }: { configId: string }) {
  const t = useT()
  const [identities, setIdentities] = React.useState<SsoIdentityRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      // For now, just show a placeholder — the identities list API is an M3 deliverable
      setIdentities([])
      setIsLoading(false)
    }
    load()
  }, [configId])

  if (isLoading) return <LoadingMessage label={t('common.loading', 'Loading...')} />

  if (identities.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">
          {t('sso.admin.activity.empty', 'No SSO login activity yet. Activity will appear here once users start logging in via SSO.')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {identities.map((identity) => (
        <div key={identity.id} className="flex items-center justify-between p-3 border rounded-md">
          <div>
            <span className="text-sm font-medium">{identity.idpEmail}</span>
            {identity.idpName && <span className="text-sm text-muted-foreground ml-2">({identity.idpName})</span>}
          </div>
          <span className="text-xs text-muted-foreground">
            {identity.lastLoginAt ? new Date(identity.lastLoginAt).toLocaleString() : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
