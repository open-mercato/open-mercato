'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { registerIntegration, getAllIntegrations, getIntegrationTitle } from '@open-mercato/shared/modules/integrations/types'

type PhaseStatus = 'idle' | 'pending' | 'ok' | 'error'
type BadgeStatusKey = 'healthy' | 'warning' | 'error' | 'unknown'
type WizardStepId = 'credentials' | 'scope' | 'schedule'
type WizardData = {
  apiKey?: string
  apiSecret?: string
  syncDirection?: string
  frequency?: string
}
type ExternalIdRow = {
  integrationId: string
  externalId: string
  syncStatus: 'synced' | 'pending'
  externalUrl?: string
}

const STATUS_CYCLE: BadgeStatusKey[] = ['healthy', 'warning', 'error', 'unknown']
const STATUS_BADGE_CLASSES: Record<BadgeStatusKey, string> = {
  healthy: 'bg-green-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
  unknown: 'bg-gray-400',
}
const EXTERNAL_ID_STATUS_CLASSES: Record<ExternalIdRow['syncStatus'], string> = {
  synced: 'bg-green-500',
  pending: 'bg-yellow-500',
}

const hintClassName = 'rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-400/10 p-2 text-xs text-amber-800 dark:text-amber-100/90'

function print(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return String(value)
  }
}

function nextStatus(current: BadgeStatusKey): BadgeStatusKey {
  const index = STATUS_CYCLE.indexOf(current)
  return STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length]
}

function StatusDot({ className }: { className: string }) {
  return <span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${className}`} />
}

export default function UmesIntegrationsPage() {
  const t = useT()

  const stepOrder = React.useMemo<WizardStepId[]>(() => ['credentials', 'scope', 'schedule'], [])
  const stepLabels = React.useMemo<Record<WizardStepId, string>>(() => ({
    credentials: t('example.umes.integrations.wizard.step1.label', 'Credentials'),
    scope: t('example.umes.integrations.wizard.step2.label', 'Scope'),
    schedule: t('example.umes.integrations.wizard.step3.label', 'Schedule'),
  }), [t])

  const [wizardStatus, setWizardStatus] = React.useState<PhaseStatus>('idle')
  const [wizardResult, setWizardResult] = React.useState<Record<string, unknown> | null>(null)
  const [wizardStepIndex, setWizardStepIndex] = React.useState(0)
  const [wizardData, setWizardData] = React.useState<WizardData>({})
  const [wizardError, setWizardError] = React.useState<string | null>(null)

  const [badgeStatus, setBadgeStatus] = React.useState<PhaseStatus>('idle')
  const [badgePhase, setBadgePhase] = React.useState(0)

  const externalIdsStatus: PhaseStatus = 'ok'

  const registrySnapshot = React.useMemo(() => {
    registerIntegration({ id: 'sync_shopify', title: 'Shopify', icon: 'shopify', buildExternalUrl: (externalId) => `https://admin.shopify.com/store/demo/products/${externalId}` })
    registerIntegration({ id: 'gateway_stripe', title: 'Stripe', icon: 'stripe' })

    return {
      integrations: getAllIntegrations(),
      titleCheck: getIntegrationTitle('sync_shopify'),
      fallbackCheck: getIntegrationTitle('unknown_id'),
    }
  }, [])

  const registryStatus: PhaseStatus = 'ok'

  const badgeStatuses = React.useMemo<BadgeStatusKey[]>(() => {
    const base: BadgeStatusKey[] = ['healthy', 'warning', 'error', 'unknown']
    return base.map((status) => {
      let current = status
      for (let step = 0; step < badgePhase; step += 1) {
        current = nextStatus(current)
      }
      return current
    })
  }, [badgePhase])

  const badgeLabels = React.useMemo(() => ['Sync Engine', 'API Gateway', 'Queue Worker', 'Cache Layer'], [])

  const externalIdRows = React.useMemo<ExternalIdRow[]>(() => ([
    {
      integrationId: 'sync_shopify',
      externalId: 'shp_prod_123',
      syncStatus: 'synced',
      externalUrl: 'https://admin.shopify.com/store/demo/products/123',
    },
    {
      integrationId: 'gateway_stripe',
      externalId: 'cus_abc456',
      syncStatus: 'pending',
    },
  ]), [])

  const currentStepId = stepOrder[wizardStepIndex]

  const handleWizardChange = React.useCallback((field: keyof WizardData, value: string) => {
    setWizardData((previous) => ({ ...previous, [field]: value }))
    setWizardError(null)
  }, [])

  const handleWizardNext = React.useCallback(() => {
    if (currentStepId === 'credentials') {
      const apiKey = wizardData.apiKey?.trim() ?? ''
      const apiSecret = wizardData.apiSecret?.trim() ?? ''
      if (!apiKey || !apiSecret) {
        setWizardError(t('example.umes.integrations.wizard.validationError', 'Both API key and API secret are required.'))
        return
      }
    }

    setWizardError(null)
    setWizardStepIndex((previous) => Math.min(previous + 1, stepOrder.length - 1))
  }, [currentStepId, stepOrder.length, t, wizardData.apiKey, wizardData.apiSecret])

  const handleWizardBack = React.useCallback(() => {
    setWizardError(null)
    setWizardStepIndex((previous) => Math.max(previous - 1, 0))
  }, [])

  const handleWizardComplete = React.useCallback(() => {
    setWizardError(null)
    setWizardStatus('ok')
    setWizardResult({
      apiKey: wizardData.apiKey ?? '',
      apiSecret: wizardData.apiSecret ?? '',
      syncDirection: wizardData.syncDirection ?? '',
      frequency: wizardData.frequency ?? '',
    })
  }, [wizardData.apiKey, wizardData.apiSecret, wizardData.frequency, wizardData.syncDirection])

  const handleCycleBadges = React.useCallback(() => {
    setBadgePhase((previous) => previous + 1)
    setBadgeStatus('ok')
  }, [])

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('example.umes.integrations.title', 'UMES Phase L — Integration Extensions')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('example.umes.integrations.description', 'Validation page for Phase L integration extensions: multi-step wizard, status badges, external ID mapping, and integration registry.')}
          </p>
        </div>

        <div className="grid gap-2 rounded border border-border p-3 text-xs text-muted-foreground">
          <div data-testid="phase-l-status-wizard">phaseL_wizard={wizardStatus}</div>
          <div data-testid="phase-l-status-badges">phaseL_badges={badgeStatus}</div>
          <div data-testid="phase-l-status-external-ids">phaseL_externalIds={externalIdsStatus}</div>
          <div data-testid="phase-l-status-registry">phaseL_registry={registryStatus}</div>
        </div>

        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.integrations.wizard.title', 'L.1 Multi-Step Wizard Widget')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.umes.integrations.wizard.description', 'Complete the 3-step wizard to validate step navigation, per-step validation, and onComplete callback.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.umes.integrations.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.integrations.wizard.hint1', '1. Step indicator should show 3 numbered circles with connecting lines.')}</div>
            <div>{t('example.umes.integrations.wizard.hint2', '2. Step 1 requires both `apiKey` and `apiSecret` — leaving them empty should show validation error.')}</div>
            <div>{t('example.umes.integrations.wizard.hint3', '3. Completing all steps should display the accumulated wizard data below.')}</div>
          </div>

          <div className="space-y-6">
            <div>{t('example.umes.integrations.wizard.wizardTitle', 'Integration Setup Wizard')}</div>

            <nav aria-label="Steps" className="mb-6">
              <ol className="flex items-center gap-2">
                {stepOrder.map((stepId, index) => {
                  const status =
                    index < wizardStepIndex ? 'completed' : index === wizardStepIndex ? 'current' : 'pending'

                  return (
                    <li key={stepId} className="flex items-center gap-2">
                      <div
                        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                          status === 'completed'
                            ? 'bg-primary text-primary-foreground'
                            : status === 'current'
                              ? 'border-2 border-primary bg-background text-primary'
                              : 'border border-muted-foreground/30 bg-muted text-muted-foreground'
                        }`}
                        aria-current={status === 'current' ? 'step' : undefined}
                      >
                        {status === 'completed' ? '✓' : index + 1}
                      </div>
                      <span className={status === 'current' ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                        {stepLabels[stepId]}
                      </span>
                      {index < stepOrder.length - 1 && <div className="h-px w-6 bg-muted-foreground/30 sm:w-12" />}
                    </li>
                  )
                })}
              </ol>
            </nav>

            {currentStepId === 'credentials' && (
              <div className="space-y-4">
                <div data-crud-field-id="apiKey" className="space-y-1">
                  <label className="text-sm font-medium">API Key</label>
                  <input
                    value={wizardData.apiKey ?? ''}
                    onChange={(event) => handleWizardChange('apiKey', event.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div data-crud-field-id="apiSecret" className="space-y-1">
                  <label className="text-sm font-medium">API Secret</label>
                  <input
                    value={wizardData.apiSecret ?? ''}
                    onChange={(event) => handleWizardChange('apiSecret', event.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

            {currentStepId === 'scope' && (
              <div data-crud-field-id="syncDirection" className="space-y-1">
                <label className="text-sm font-medium">Sync Direction</label>
                <select
                  value={wizardData.syncDirection ?? ''}
                  onChange={(event) => handleWizardChange('syncDirection', event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select direction</option>
                  <option value="push">Push</option>
                  <option value="pull">Pull</option>
                  <option value="bidirectional">Bidirectional</option>
                </select>
              </div>
            )}

            {currentStepId === 'schedule' && (
              <div data-crud-field-id="frequency" className="space-y-1">
                <label className="text-sm font-medium">Frequency</label>
                <select
                  value={wizardData.frequency ?? ''}
                  onChange={(event) => handleWizardChange('frequency', event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select frequency</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            )}

            {wizardError && <p className="text-sm text-destructive">{wizardError}</p>}

            <div className="flex items-center justify-between border-t pt-4">
              <div>
                {wizardStepIndex > 0 && (
                  <Button type="button" variant="outline" onClick={handleWizardBack}>
                    Back
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {wizardStepIndex === stepOrder.length - 1 ? (
                  <Button type="button" onClick={handleWizardComplete}>
                    Complete
                  </Button>
                ) : (
                  <Button type="button" onClick={handleWizardNext}>
                    Next
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div data-testid="phase-l-wizard-result" className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            wizardResult={print(wizardResult)}
          </div>
        </div>

        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.integrations.badges.title', 'L.2 Status Badge Injection')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.umes.integrations.badges.description', 'Four status badge renderers with fixed loaders demonstrating healthy, warning, error, and unknown states.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.umes.integrations.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.integrations.badges.hint1', '1. Four badges should render with colored dots (green, yellow, red, gray).')}</div>
            <div>{t('example.umes.integrations.badges.hint2', '2. Hovering over badges with tooltips should show the tooltip text.')}</div>
            <div>{t('example.umes.integrations.badges.hint3', '3. Clicking `Cycle statuses` should rotate all badge statuses forward.')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-3" data-testid="phase-l-badges">
            {badgeLabels.map((label, index) => (
              <div key={label} className="px-2 py-1">
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <StatusDot className={STATUS_BADGE_CLASSES[badgeStatuses[index]]} />
                  <span>{label}</span>
                  {index === 0 && <span className="rounded bg-muted px-1.5 py-0 text-xs">42</span>}
                  {index === 2 && <span className="rounded bg-muted px-1.5 py-0 text-xs">3</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="phase-l-cycle-badges" type="button" onClick={handleCycleBadges}>
              {t('example.umes.integrations.badges.cycle', 'Cycle statuses')}
            </Button>
            <span data-testid="phase-l-badge-status" className="text-xs text-muted-foreground">status={badgeStatus}</span>
          </div>
        </div>

        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.integrations.externalIds.title', 'L.3 External ID Mapping Display')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.umes.integrations.externalIds.description', 'ExternalIdsWidget renders mock integration mappings for Shopify and Stripe.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.umes.integrations.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.integrations.externalIds.hint1', '1. Two integration rows should display: Shopify (synced, green dot) and Stripe (pending, yellow dot).')}</div>
            <div>{t('example.umes.integrations.externalIds.hint2', '2. Shopify row should show an external link icon.')}</div>
            <div>{t('example.umes.integrations.externalIds.hint3', '3. Each row shows the external ID in a monospace code badge.')}</div>
          </div>
          <div data-testid="phase-l-external-ids" className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">External IDs</h3>
            <div className="space-y-2">
              {externalIdRows.map((row) => (
                <div key={row.integrationId} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-sm font-medium truncate">{getIntegrationTitle(row.integrationId)}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">{row.externalId}</code>
                    {row.externalUrl && (
                      <a
                        href={row.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Open in external system"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <StatusDot className={EXTERNAL_ID_STATUS_CLASSES[row.syncStatus]} />
                    <span>{row.syncStatus}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.integrations.registry.title', 'L.4 Integration Registry')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.umes.integrations.registry.description', 'Demonstrates registerIntegration(), getAllIntegrations(), and getIntegrationTitle() from the shared registry.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.umes.integrations.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.integrations.registry.hint1', "1. Two integrations should be registered on mount (sync_shopify, gateway_stripe).")}</div>
            <div>{t('example.umes.integrations.registry.hint2', "2. `getIntegrationTitle('sync_shopify')` should return 'Shopify' (not the raw ID).")}</div>
            <div>{t('example.umes.integrations.registry.hint3', "3. `getIntegrationTitle('unknown_id')` should fall back to 'unknown_id'.")}</div>
          </div>
          <div data-testid="phase-l-registry" className="grid gap-2 rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            <div>getAllIntegrations()={print(registrySnapshot.integrations)}</div>
            <div>getIntegrationTitle(&apos;sync_shopify&apos;)={print(registrySnapshot.titleCheck)}</div>
            <div>getIntegrationTitle(&apos;unknown_id&apos;)={print(registrySnapshot.fallbackCheck)}</div>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
