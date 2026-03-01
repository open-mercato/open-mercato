'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type WizardStep = 'protocol' | 'credentials' | 'domains' | 'options' | 'review'

const STEPS: WizardStep[] = ['protocol', 'credentials', 'domains', 'options', 'review']

interface WizardState {
  name: string
  protocol: 'oidc'
  issuer: string
  clientId: string
  clientSecret: string
  domains: string[]
  jitEnabled: boolean
  autoLinkByEmail: boolean
}

const initialState: WizardState = {
  name: '',
  protocol: 'oidc',
  issuer: '',
  clientId: '',
  clientSecret: '',
  domains: [],
  jitEnabled: true,
  autoLinkByEmail: true,
}

export default function SsoConfigCreateWizard() {
  const router = useRouter()
  const t = useT()
  const [step, setStep] = React.useState<WizardStep>('protocol')
  const [state, setState] = React.useState<WizardState>(initialState)
  const [domainInput, setDomainInput] = React.useState('')
  const [domainError, setDomainError] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ ok: boolean; error?: string } | null>(null)
  const [isTesting, setIsTesting] = React.useState(false)

  React.useEffect(() => {
    const checkExisting = async () => {
      const call = await apiCall<{ items: { id: string }[] }>('/api/sso/config?pageSize=1')
      if (call.ok && call.result && call.result.items.length > 0) {
        flash(t('sso.admin.error.alreadyExists', 'An SSO configuration already exists for this organization'), 'error')
        router.replace(`/backend/sso/config/${call.result.items[0].id}`)
      }
    }
    checkExisting()
  }, [router, t])

  const currentStepIndex = STEPS.indexOf(step)

  const callbackUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/sso/callback/oidc`
    : '/api/sso/callback/oidc'

  const goNext = () => {
    const nextIndex = currentStepIndex + 1
    if (nextIndex < STEPS.length) setStep(STEPS[nextIndex])
  }

  const goBack = () => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) setStep(STEPS[prevIndex])
  }

  const handleAddDomain = () => {
    const normalized = domainInput.trim().toLowerCase()
    if (!normalized) return

    const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/
    if (!domainRegex.test(normalized) || !normalized.includes('.')) {
      setDomainError(t('sso.admin.wizard.domain.invalid', 'Invalid domain format'))
      return
    }

    if (state.domains.includes(normalized)) {
      setDomainError(t('sso.admin.wizard.domain.duplicate', 'Domain already added'))
      return
    }

    if (state.domains.length >= 20) {
      setDomainError(t('sso.admin.wizard.domain.limit', 'Maximum 20 domains per configuration'))
      return
    }

    setState((prev) => ({ ...prev, domains: [...prev.domains, normalized] }))
    setDomainInput('')
    setDomainError('')
  }

  const handleRemoveDomain = (domain: string) => {
    setState((prev) => ({ ...prev, domains: prev.domains.filter((d) => d !== domain) }))
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const call = await apiCallOrThrow<{ id: string }>(
        '/api/sso/config',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: state.name,
            protocol: state.protocol,
            issuer: state.issuer,
            clientId: state.clientId,
            clientSecret: state.clientSecret,
            allowedDomains: state.domains,
            jitEnabled: state.jitEnabled,
            autoLinkByEmail: state.autoLinkByEmail,
          }),
        },
        { errorMessage: t('sso.admin.error.createFailed', 'Failed to create SSO configuration') },
      )
      flash(t('sso.admin.created', 'SSO configuration created'), 'success')
      router.push(`/backend/sso/config/${call.result?.id}?created=1`)
    } catch {
      // apiCallOrThrow handles the error
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      // For testing before creation, we do a lightweight discovery check
      const response = await fetch(state.issuer + '/.well-known/openid-configuration')
      if (response.ok) {
        setTestResult({ ok: true })
        flash(t('sso.admin.test.success', 'Discovery successful — issuer is reachable'), 'success')
      } else {
        setTestResult({ ok: false, error: `HTTP ${response.status}` })
        flash(t('sso.admin.test.failed', 'Discovery failed'), 'error')
      }
    } catch (err) {
      setTestResult({ ok: false, error: String(err) })
      flash(t('sso.admin.test.failed', 'Discovery failed — issuer is not reachable'), 'error')
    } finally {
      setIsTesting(false)
    }
  }

  const canProceed = (): boolean => {
    switch (step) {
      case 'protocol': return true
      case 'credentials': return !!(state.name && state.issuer && state.clientId && state.clientSecret)
      case 'domains': return true
      case 'options': return true
      case 'review': return !isSubmitting
      default: return false
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="max-w-2xl mx-auto">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8">
            {STEPS.map((s, i) => (
              <React.Fragment key={s}>
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                    i <= currentStepIndex
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 ${i < currentStepIndex ? 'bg-primary' : 'bg-muted'}`} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Step content */}
          {step === 'protocol' && (
            <div>
              <h2 className="text-lg font-semibold mb-4">{t('sso.admin.wizard.protocol.title', 'Select Protocol')}</h2>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-4 border rounded-lg cursor-pointer bg-accent/50 border-primary">
                  <input type="radio" name="protocol" value="oidc" checked readOnly className="accent-primary" />
                  <div>
                    <div className="font-medium">OpenID Connect (OIDC)</div>
                    <div className="text-sm text-muted-foreground">
                      {t('sso.admin.wizard.protocol.oidcDesc', 'Works with Zitadel, Microsoft Entra ID, Google Workspace, Okta, and more')}
                    </div>
                  </div>
                </label>
                <div className="flex items-center gap-3 p-4 border rounded-lg opacity-50 cursor-not-allowed bg-muted/30">
                  <input type="radio" name="protocol" value="saml" disabled className="accent-primary" />
                  <div>
                    <div className="font-medium">SAML 2.0</div>
                    <div className="text-sm text-muted-foreground">
                      {t('sso.admin.wizard.protocol.samlDesc', 'Coming soon')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'credentials' && (
            <div>
              <h2 className="text-lg font-semibold mb-4">{t('sso.admin.wizard.credentials.title', 'OIDC Credentials')}</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('sso.admin.field.name', 'Configuration Name')}</label>
                  <input
                    type="text"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    placeholder={t('sso.admin.wizard.credentials.namePlaceholder', 'e.g., Zitadel Production')}
                    value={state.name}
                    onChange={(e) => setState((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('sso.admin.field.issuer', 'Issuer URL')}</label>
                  <input
                    type="url"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    placeholder="https://your-idp.example.com"
                    value={state.issuer}
                    onChange={(e) => setState((prev) => ({ ...prev, issuer: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('sso.admin.field.clientId', 'Client ID')}</label>
                  <input
                    type="text"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={state.clientId}
                    onChange={(e) => setState((prev) => ({ ...prev, clientId: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('sso.admin.field.clientSecret', 'Client Secret')}</label>
                  <input
                    type="password"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={state.clientSecret}
                    onChange={(e) => setState((prev) => ({ ...prev, clientSecret: e.target.value }))}
                  />
                </div>
                <div className="rounded-md bg-muted/50 p-3">
                  <label className="block text-sm font-medium mb-1">{t('sso.admin.wizard.credentials.callbackUrl', 'Redirect URI (copy to your IdP)')}</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm bg-background p-2 rounded border font-mono break-all">{callbackUrl}</code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(callbackUrl)
                        flash(t('common.copied', 'Copied to clipboard'), 'success')
                      }}
                    >
                      {t('common.copy', 'Copy')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'domains' && (
            <div>
              <h2 className="text-lg font-semibold mb-4">{t('sso.admin.wizard.domains.title', 'Allowed Email Domains')}</h2>
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
              {state.domains.length > 0 && (
                <div className="space-y-2">
                  {state.domains.map((domain) => (
                    <div key={domain} className="flex items-center justify-between p-2 border rounded-md">
                      <code className="text-sm font-mono">{domain}</code>
                      <Button variant="ghost" size="sm" onClick={() => handleRemoveDomain(domain)}>
                        {t('common.remove', 'Remove')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'options' && (
            <div>
              <h2 className="text-lg font-semibold mb-4">{t('sso.admin.wizard.options.title', 'Options')}</h2>
              <div className="space-y-4">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={state.jitEnabled}
                    onChange={(e) => setState((prev) => ({ ...prev, jitEnabled: e.target.checked }))}
                    className="accent-primary"
                  />
                  <div>
                    <div className="font-medium text-sm">{t('sso.admin.field.jitEnabled', 'Just-in-Time Provisioning')}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('sso.admin.field.jitEnabledDesc', 'Automatically create user accounts on first SSO login')}
                    </div>
                  </div>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={state.autoLinkByEmail}
                    onChange={(e) => setState((prev) => ({ ...prev, autoLinkByEmail: e.target.checked }))}
                    className="accent-primary"
                  />
                  <div>
                    <div className="font-medium text-sm">{t('sso.admin.field.autoLinkByEmail', 'Auto-link by Email')}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('sso.admin.field.autoLinkByEmailDesc', 'Automatically link existing users by matching email address')}
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div>
              <h2 className="text-lg font-semibold mb-4">{t('sso.admin.wizard.review.title', 'Review & Save')}</h2>
              <div className="space-y-4">
                <div className="border rounded-lg divide-y">
                  <div className="flex justify-between p-3">
                    <span className="text-sm text-muted-foreground">{t('sso.admin.field.name', 'Name')}</span>
                    <span className="text-sm font-medium">{state.name}</span>
                  </div>
                  <div className="flex justify-between p-3">
                    <span className="text-sm text-muted-foreground">{t('sso.admin.field.protocol', 'Protocol')}</span>
                    <span className="text-sm font-medium">{state.protocol.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between p-3">
                    <span className="text-sm text-muted-foreground">{t('sso.admin.field.issuer', 'Issuer')}</span>
                    <span className="text-sm font-medium break-all">{state.issuer}</span>
                  </div>
                  <div className="flex justify-between p-3">
                    <span className="text-sm text-muted-foreground">{t('sso.admin.field.clientId', 'Client ID')}</span>
                    <span className="text-sm font-medium">{state.clientId}</span>
                  </div>
                  <div className="flex justify-between p-3">
                    <span className="text-sm text-muted-foreground">{t('sso.admin.wizard.domains.title', 'Domains')}</span>
                    <span className="text-sm font-medium">{state.domains.join(', ') || '—'}</span>
                  </div>
                  <div className="flex justify-between p-3">
                    <span className="text-sm text-muted-foreground">{t('sso.admin.field.jitEnabled', 'JIT Provisioning')}</span>
                    <span className="text-sm font-medium">{state.jitEnabled ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled')}</span>
                  </div>
                  <div className="flex justify-between p-3">
                    <span className="text-sm text-muted-foreground">{t('sso.admin.field.autoLinkByEmail', 'Auto-link')}</span>
                    <span className="text-sm font-medium">{state.autoLinkByEmail ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled')}</span>
                  </div>
                </div>

                {/* Test connection before saving */}
                <div className="flex items-center gap-3 p-4 border rounded-lg bg-muted/30">
                  <Button
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={isTesting}
                  >
                    {isTesting
                      ? t('sso.admin.wizard.review.testing', 'Testing...')
                      : t('sso.admin.action.test', 'Verify Discovery')}
                  </Button>
                  {testResult && (
                    <span className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}>
                      {testResult.ok
                        ? t('sso.admin.test.success', 'Discovery successful')
                        : testResult.error || t('sso.admin.test.failed', 'Discovery failed')}
                    </span>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">
                  {t('sso.admin.wizard.review.note', 'The configuration will be created as inactive. You can activate it from the detail page after verifying everything is correct.')}
                </p>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8 pt-4 border-t">
            <div>
              {currentStepIndex > 0 ? (
                <Button variant="outline" onClick={goBack}>
                  {t('common.back', 'Back')}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => router.push('/backend/sso')}>
                  {t('common.cancel', 'Cancel')}
                </Button>
              )}
            </div>
            <div>
              {step === 'review' ? (
                <Button onClick={handleSubmit} disabled={!canProceed()}>
                  {isSubmitting
                    ? t('common.saving', 'Saving...')
                    : t('sso.admin.wizard.review.save', 'Create Configuration')}
                </Button>
              ) : (
                <Button onClick={goNext} disabled={!canProceed()}>
                  {t('common.next', 'Next')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
