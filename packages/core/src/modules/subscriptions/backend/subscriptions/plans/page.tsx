"use client"

import * as React from 'react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type PlanItem = {
  code: string
  productCode: string
  title: string
  description: string | null
  entitlements: Record<string, unknown>
  prices: Array<{
    code: string
    currencyCode: string
    interval: 'month' | 'year'
    intervalCount: number
    unitAmountMinor: number
    trialDays: number | null
    isDefault: boolean
  }>
}

type PlansResponse = { items: PlanItem[] }

function formatPrice(price: PlanItem['prices'][number]): string {
  const value = price.unitAmountMinor / 100
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currencyCode }).format(value)
  } catch {
    return `${value.toFixed(2)} ${price.currencyCode}`
  }
}

export default function PlansListPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [plans, setPlans] = React.useState<PlanItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [syncing, setSyncing] = React.useState(false)
  const { runMutation } = useGuardedMutation<{ entityType: string; entityId?: string }>({
    contextId: 'subscriptions:plans',
  })

  const load = React.useCallback(async () => {
    setLoading(true)
    const call = await apiCall<PlansResponse>('/api/subscriptions/plans', undefined, { fallback: { items: [] as PlanItem[] } })
    if (call.ok && call.result) {
      setPlans(call.result.items)
    } else {
      flash(t('subscriptions.errors.loadFailed', 'Failed to load plans'), 'error')
      setPlans([])
    }
    setLoading(false)
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load, scopeVersion])

  const handleSync = React.useCallback(async () => {
    setSyncing(true)
    try {
      await runMutation({
        operation: async () => {
          await apiCallOrThrow('/api/subscriptions/plans/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
        },
        context: { entityType: 'subscriptions:subscription_plan' },
        mutationPayload: {},
      })
      flash(t('subscriptions.plans.syncSuccess', 'Plans synced'), 'success')
      await load()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('subscriptions.errors.syncFailed', 'Could not sync plans'), 'error')
    } finally {
      setSyncing(false)
    }
  }, [load, runMutation, t])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('subscriptions.plans.loading', 'Loading plans')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title={t('subscriptions.plans.title', 'Plans')}
        description={t('subscriptions.plans.description', 'Synced subscription plans and prices. Plans are versioned in repo and synced to Stripe.')}
        actions={(
          <Button type="button" onClick={() => void handleSync()} disabled={syncing}>
            {syncing
              ? t('subscriptions.plans.syncing', 'Syncing…')
              : t('subscriptions.plans.syncButton', 'Sync plans now')}
          </Button>
        )}
      />
      <PageBody className="space-y-4">
        {plans.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t('subscriptions.plans.empty', 'No plans synced yet')}</div>
        ) : null}
        {plans.map((plan) => (
          <Card key={plan.code}>
            <CardHeader>
              <CardTitle>
                {plan.title}
                <span className="ml-2 text-sm font-normal text-muted-foreground">{plan.code} · {plan.productCode}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {plan.description ? (
                <p className="text-sm text-muted-foreground">{plan.description}</p>
              ) : null}
              <div>
                <div className="text-overline uppercase text-muted-foreground">{t('subscriptions.plans.prices', 'Prices')}</div>
                <ul className="mt-2 grid gap-2 md:grid-cols-2">
                  {plan.prices.map((price) => (
                    <li key={price.code} className="rounded-lg border bg-muted/30 px-4 py-3">
                      <div className="text-sm font-medium">{formatPrice(price)} / {price.intervalCount > 1 ? `${price.intervalCount} ` : ''}{price.interval}</div>
                      <div className="text-xs text-muted-foreground">{price.code}{price.isDefault ? ' · default' : ''}{price.trialDays ? ` · ${price.trialDays}d trial` : ''}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        ))}
      </PageBody>
    </Page>
  )
}
