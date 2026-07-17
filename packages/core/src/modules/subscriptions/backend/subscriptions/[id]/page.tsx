"use client"

import * as React from 'react'
import { useParams } from 'next/navigation'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SubscriptionDetail = {
  subscription: {
    id: string
    externalAccountId: string
    subjectEntityType: string
    subjectEntityId: string
    planCode: string | null
    priceCode: string | null
    productCode: string | null
    provider: string
    providerCustomerId: string
    providerSubscriptionId: string | null
    providerStatus: string
    accessState: 'pending' | 'granted' | 'grace' | 'blocked'
    currentPeriodStart: string | null
    currentPeriodEnd: string | null
    trialEndsAt: string | null
    cancelAtPeriodEnd: boolean
    cancelledAt: string | null
    lastProviderEventAt: string | null
    createdAt: string | null
    updatedAt: string | null
  }
  billingRecords: Array<{
    id: string
    provider: string
    providerInvoiceId: string | null
    providerChargeId: string | null
    status: 'paid' | 'failed' | 'void' | 'refunded' | 'unknown'
    amountMinor: number
    currencyCode: string
    periodStart: string | null
    periodEnd: string | null
    eventType: string
    processedAt: string | null
  }>
}

const ACCESS_STATE_TONE: Record<string, string> = {
  granted: 'bg-emerald-100 text-emerald-800',
  grace: 'bg-amber-100 text-amber-800',
  pending: 'bg-slate-100 text-slate-800',
  blocked: 'bg-rose-100 text-rose-800',
}

function formatAmount(minor: number, currency: string): string {
  const value = minor / 100
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export default function SubscriptionDetailPage() {
  const t = useT()
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [detail, setDetail] = React.useState<SubscriptionDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<{ entityType: string; entityId?: string }>({
    contextId: 'subscriptions:detail',
  })

  const load = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    const call = await apiCall<SubscriptionDetail>(`/api/subscriptions/detail/${encodeURIComponent(id)}`, undefined, { fallback: null })
    if (call.ok && call.result) {
      setDetail(call.result)
    } else {
      setError(t('subscriptions.errors.detailFailed', 'Failed to load subscription detail'))
      setDetail(null)
    }
    setLoading(false)
  }, [id, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleReconcile = React.useCallback(async () => {
    if (!detail) return
    try {
      await runMutation({
        operation: async () => {
          await apiCallOrThrow(`/api/subscriptions/${encodeURIComponent(detail.subscription.id)}/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
        },
        context: {
          entityType: 'subscriptions:subscription',
          entityId: detail.subscription.id,
        },
        mutationPayload: { subscriptionId: detail.subscription.id },
      })
      flash(t('subscriptions.detail.reconcileQueued', 'Reconcile triggered'), 'success')
      await load()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('subscriptions.errors.reconcileFailed', 'Reconcile failed'), 'error')
    }
  }, [detail, load, runMutation, t])

  const handleCancel = React.useCallback(async () => {
    if (!detail) return
    const ok = await confirm({
      title: t('subscriptions.detail.cancelConfirmTitle', 'Cancel subscription?'),
      description: t('subscriptions.detail.cancelConfirmBody', 'The subscription will be cancelled at the end of the current period.'),
      confirmText: t('subscriptions.detail.cancelConfirmAction', 'Cancel subscription'),
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await runMutation({
        operation: async () => {
          await apiCallOrThrow(`/api/subscriptions/${encodeURIComponent(detail.subscription.id)}/cancel`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ atPeriodEnd: true }),
          })
        },
        context: {
          entityType: 'subscriptions:subscription',
          entityId: detail.subscription.id,
        },
        mutationPayload: { subscriptionId: detail.subscription.id, atPeriodEnd: true },
      })
      flash(t('subscriptions.detail.cancelQueued', 'Cancel request sent to provider'), 'success')
      await load()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('subscriptions.errors.cancelFailed', 'Cancel failed'), 'error')
    }
  }, [confirm, detail, load, runMutation, t])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('subscriptions.detail.loading', 'Loading subscription')} />
        </PageBody>
      </Page>
    )
  }
  if (error || !detail) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('subscriptions.errors.notFound', 'Subscription not found')} />
        </PageBody>
      </Page>
    )
  }

  const sub = detail.subscription

  return (
    <Page>
      <PageHeader
        title={t('subscriptions.detail.title', 'Subscription')}
        description={sub.externalAccountId}
        actions={(
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void handleReconcile()}>
              {t('subscriptions.detail.forceReconcileButton', 'Force reconcile')}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleCancel()} disabled={sub.cancelAtPeriodEnd}>
              {t('subscriptions.detail.cancelButton', 'Cancel subscription')}
            </Button>
          </div>
        )}
      />
      <PageBody className="space-y-6">
        {ConfirmDialogElement}
        <Card>
          <CardHeader>
            <CardTitle>{t('subscriptions.detail.state', 'Current state')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div>
              <div className="text-overline uppercase text-muted-foreground">{t('subscriptions.detail.accessState', 'Access state')}</div>
              <Badge variant="secondary" className={ACCESS_STATE_TONE[sub.accessState] ?? ''}>
                {t(`subscriptions.accessState.${sub.accessState}`, sub.accessState)}
              </Badge>
            </div>
            <div>
              <div className="text-overline uppercase text-muted-foreground">{t('subscriptions.detail.providerStatus', 'Provider status')}</div>
              <div className="text-sm">{sub.providerStatus}</div>
            </div>
            <div>
              <div className="text-overline uppercase text-muted-foreground">{t('subscriptions.detail.plan', 'Plan')}</div>
              <div className="text-sm">{sub.planCode ?? '—'} / {sub.priceCode ?? '—'}</div>
            </div>
            <div>
              <div className="text-overline uppercase text-muted-foreground">{t('subscriptions.detail.currentPeriod', 'Current period')}</div>
              <div className="text-sm">{formatDateTime(sub.currentPeriodStart)} → {formatDateTime(sub.currentPeriodEnd)}</div>
            </div>
            <div>
              <div className="text-overline uppercase text-muted-foreground">{t('subscriptions.detail.trial', 'Trial ends')}</div>
              <div className="text-sm">{formatDateTime(sub.trialEndsAt)}</div>
            </div>
            <div>
              <div className="text-overline uppercase text-muted-foreground">{t('subscriptions.detail.cancelAtPeriodEnd', 'Cancel at period end')}</div>
              <div className="text-sm">{sub.cancelAtPeriodEnd ? 'Yes' : 'No'}</div>
            </div>
            <div>
              <div className="text-overline uppercase text-muted-foreground">{t('subscriptions.detail.providerSubscriptionId', 'Provider subscription ID')}</div>
              <div className="break-all text-sm">{sub.providerSubscriptionId ?? '—'}</div>
            </div>
            <div>
              <div className="text-overline uppercase text-muted-foreground">{t('subscriptions.detail.providerCustomerId', 'Provider customer ID')}</div>
              <div className="break-all text-sm">{sub.providerCustomerId}</div>
            </div>
            <div>
              <div className="text-overline uppercase text-muted-foreground">{t('subscriptions.detail.lastEvent', 'Last provider event')}</div>
              <div className="text-sm">{formatDateTime(sub.lastProviderEventAt)}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('subscriptions.detail.billingRecords', 'Billing history')}</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.billingRecords.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('subscriptions.detail.billingEmpty', 'No billing records yet')}</div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">{t('subscriptions.detail.columns.eventType', 'Event')}</th>
                      <th className="px-4 py-2 text-left font-medium">{t('subscriptions.detail.columns.status', 'Status')}</th>
                      <th className="px-4 py-2 text-left font-medium">{t('subscriptions.detail.columns.amount', 'Amount')}</th>
                      <th className="px-4 py-2 text-left font-medium">{t('subscriptions.detail.columns.invoice', 'Invoice')}</th>
                      <th className="px-4 py-2 text-left font-medium">{t('subscriptions.detail.columns.processedAt', 'Processed')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.billingRecords.map((record) => (
                      <tr key={record.id} className="border-b last:border-0">
                        <td className="px-4 py-2">{record.eventType}</td>
                        <td className="px-4 py-2">{record.status}</td>
                        <td className="px-4 py-2">{formatAmount(record.amountMinor, record.currencyCode)}</td>
                        <td className="px-4 py-2 font-mono text-xs">{record.providerInvoiceId ?? '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground">{formatDateTime(record.processedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </Page>
  )
}
