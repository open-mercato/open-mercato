'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { TooltipProvider } from '@open-mercato/ui/primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { InjectionWizard } from '@open-mercato/ui/backend/injection/InjectionWizard'
import { StatusBadgeRenderer } from '@open-mercato/ui/backend/injection/StatusBadgeRenderer'
import ExternalIdsWidget from '@open-mercato/core/modules/integrations/widgets/injection/external-ids/widget.client'
import { registerIntegration, getAllIntegrations, getIntegrationTitle } from '@open-mercato/shared/modules/integrations/types'
import type {
  InjectionWizardWidget,
  InjectionContext,
  InjectionStatusBadgeWidget,
  StatusBadgeResult,
  StatusBadgeContext,
} from '@open-mercato/shared/modules/widgets/injection'

type PhaseStatus = 'idle' | 'pending' | 'ok' | 'error'

type BadgeStatusKey = StatusBadgeResult['status']

const STATUS_CYCLE: BadgeStatusKey[] = ['healthy', 'warning', 'error', 'unknown']

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

export default function UmesIntegrationsPage() {
  const t = useT()

  const [wizardStatus, setWizardStatus] = React.useState<PhaseStatus>('idle')
  const [wizardResult, setWizardResult] = React.useState<Record<string, unknown> | null>(null)

  const [badgeStatus, setBadgeStatus] = React.useState<PhaseStatus>('idle')
  const [badgePhase, setBadgePhase] = React.useState(0)

  const [externalIdsStatus] = React.useState<PhaseStatus>('ok')

  const [registryStatus, setRegistryStatus] = React.useState<PhaseStatus>('idle')
  const [registryData, setRegistryData] = React.useState<unknown>(null)
  const [registryTitleCheck, setRegistryTitleCheck] = React.useState<string | null>(null)
  const [registryFallbackCheck, setRegistryFallbackCheck] = React.useState<string | null>(null)

  const wizardContext = React.useMemo<InjectionContext>(() => ({
    organizationId: 'demo-org',
    tenantId: 'demo-tenant',
    userId: 'demo-user',
    path: '/backend/umes-integrations',
  }), [])

  const wizardWidget = React.useMemo<InjectionWizardWidget>(() => ({
    metadata: {
      id: 'example.umes.integrations.wizard',
      title: t('example.umes.integrations.wizard.wizardTitle', 'Integration Setup Wizard'),
    },
    kind: 'wizard',
    steps: [
      {
        id: 'credentials',
        label: t('example.umes.integrations.wizard.step1.label', 'Credentials'),
        fields: [
          { id: 'apiKey', label: 'API Key', type: 'text', group: t('example.umes.integrations.wizard.step1.description', 'Enter API credentials for the external system.') },
          { id: 'apiSecret', label: 'API Secret', type: 'text', group: t('example.umes.integrations.wizard.step1.description', 'Enter API credentials for the external system.') },
        ],
        validate: async (data) => {
          const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : ''
          const apiSecret = typeof data.apiSecret === 'string' ? data.apiSecret.trim() : ''
          if (!apiKey || !apiSecret) {
            return { ok: false, message: t('example.umes.integrations.wizard.validationError', 'Both API key and API secret are required.') }
          }
          return { ok: true }
        },
      },
      {
        id: 'scope',
        label: t('example.umes.integrations.wizard.step2.label', 'Scope'),
        fields: [
          {
            id: 'syncDirection',
            label: 'Sync Direction',
            type: 'select',
            options: [
              { value: 'push', label: 'Push' },
              { value: 'pull', label: 'Pull' },
              { value: 'bidirectional', label: 'Bidirectional' },
            ],
            group: t('example.umes.integrations.wizard.step2.description', 'Configure synchronization direction.'),
          },
        ],
      },
      {
        id: 'schedule',
        label: t('example.umes.integrations.wizard.step3.label', 'Schedule'),
        fields: [
          {
            id: 'frequency',
            label: 'Frequency',
            type: 'select',
            options: [
              { value: 'hourly', label: 'Hourly' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
            ],
            group: t('example.umes.integrations.wizard.step3.description', 'Set the sync frequency.'),
          },
        ],
      },
    ],
    onComplete: async (stepData) => {
      setWizardResult(stepData)
      setWizardStatus('ok')
    },
  }), [t])

  const badgeStatuses = React.useMemo<BadgeStatusKey[]>(() => {
    const base: BadgeStatusKey[] = ['healthy', 'warning', 'error', 'unknown']
    return base.map((status) => {
      let current = status
      for (let step = 0; step < badgePhase; step++) {
        current = nextStatus(current)
      }
      return current
    })
  }, [badgePhase])

  const badgeWidgets = React.useMemo<{ widget: InjectionStatusBadgeWidget; context: StatusBadgeContext }[]>(() => {
    const labels = ['Sync Engine', 'API Gateway', 'Queue Worker', 'Cache Layer']
    const tooltips = ['All systems operational', 'High latency detected', '3 failed jobs', undefined]
    const counts = [42, undefined, 3, undefined]
    const ctx: StatusBadgeContext = { organizationId: 'demo-org', tenantId: 'demo-tenant', userId: 'demo-user' }

    return labels.map((label, index) => ({
      widget: {
        metadata: { id: `example.umes.badge.${label.toLowerCase().replace(/\s/g, '-')}` },
        kind: 'status-badge' as const,
        badge: {
          label,
          pollInterval: 999999,
          statusLoader: async (): Promise<StatusBadgeResult> => ({
            status: badgeStatuses[index],
            tooltip: tooltips[index],
            count: counts[index],
          }),
        },
      },
      context: ctx,
    }))
  }, [badgeStatuses])

  const handleCycleBadges = React.useCallback(() => {
    setBadgePhase((previous) => previous + 1)
    setBadgeStatus('ok')
  }, [])

  const externalIdsData = React.useMemo(() => ({
    _integrations: {
      sync_shopify: {
        externalId: 'shp_prod_123',
        syncStatus: 'synced' as const,
        lastSyncedAt: new Date(Date.now() - 3600000).toISOString(),
        externalUrl: 'https://admin.shopify.com/store/demo/products/123',
      },
      gateway_stripe: {
        externalId: 'cus_abc456',
        syncStatus: 'pending' as const,
      },
    },
  }), [])

  React.useEffect(() => {
    registerIntegration({ id: 'sync_shopify', title: 'Shopify', icon: 'shopify', buildExternalUrl: (externalId) => `https://admin.shopify.com/store/demo/products/${externalId}` })
    registerIntegration({ id: 'gateway_stripe', title: 'Stripe', icon: 'stripe' })

    setRegistryData(getAllIntegrations())
    setRegistryTitleCheck(getIntegrationTitle('sync_shopify'))
    setRegistryFallbackCheck(getIntegrationTitle('unknown_id'))
    setRegistryStatus('ok')
  }, [])

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('example.umes.integrations.title', 'UMES Phase I-L Integrations')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('example.umes.integrations.description', 'Validation page for integration wizards, status badges, external ID widgets, and the integration registry.')}
          </p>
        </div>

        <div className="grid gap-2 rounded border border-border p-3 text-xs text-muted-foreground">
          <div data-testid="phase-il-status-wizard">phaseL_wizard={wizardStatus}</div>
          <div data-testid="phase-il-status-badges">phaseL_badges={badgeStatus}</div>
          <div data-testid="phase-il-status-external-ids">phaseL_externalIds={externalIdsStatus}</div>
          <div data-testid="phase-il-status-registry">phaseL_registry={registryStatus}</div>
        </div>

        {/* Section 1: InjectionWizard Demo */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.integrations.wizard.title', 'Phase I — Injection Wizard')}</h2>
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
          <InjectionWizard widget={wizardWidget} context={wizardContext} />
          <div data-testid="phase-i-wizard-result" className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            wizardResult={print(wizardResult)}
          </div>
        </div>

        {/* Section 2: StatusBadgeRenderer Demo */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.integrations.badges.title', 'Phase J — Status Badges')}</h2>
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
          <TooltipProvider delayDuration={300}>
            <div className="flex flex-wrap items-center gap-3" data-testid="phase-j-badges">
              {badgeWidgets.map(({ widget, context }) => (
                <StatusBadgeRenderer key={widget.metadata.id} widget={widget} context={context} />
              ))}
            </div>
          </TooltipProvider>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="phase-j-cycle" type="button" onClick={handleCycleBadges}>
              {t('example.umes.integrations.badges.cycle', 'Cycle statuses')}
            </Button>
            <span data-testid="phase-j-status" className="text-xs text-muted-foreground">status={badgeStatus}</span>
          </div>
        </div>

        {/* Section 3: ExternalIdsWidget Demo */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.integrations.externalIds.title', 'Phase K — External IDs Widget')}</h2>
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
          <div data-testid="phase-k-external-ids">
            <ExternalIdsWidget context={{}} data={externalIdsData} />
          </div>
        </div>

        {/* Section 4: Integration Registry Demo */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.integrations.registry.title', 'Phase L — Integration Registry')}</h2>
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
            <div>getAllIntegrations()={print(registryData)}</div>
            <div>getIntegrationTitle(&apos;sync_shopify&apos;)={print(registryTitleCheck)}</div>
            <div>getIntegrationTitle(&apos;unknown_id&apos;)={print(registryFallbackCheck)}</div>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
