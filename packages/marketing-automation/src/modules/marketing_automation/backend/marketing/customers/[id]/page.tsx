"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'

/** The run statuses this module produces, mapped to the design system's own status vocabulary. */
const RUN_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  completed: 'success',
  running: 'info',
  claimed: 'info',
  waiting: 'neutral',
  failed: 'warning',
  dead: 'error',
}

type Profile = {
  customer: { id: string; displayName: string | null; email: string | null; createdAt: string | null }
  score: { points: number; tier: string | null; tierRank: number; pointsToNext: number | null }
  orders: { count: number; totalGross: number; lastPlacedAt: string | null; daysSinceLast: number | null }
  tags: string[]
  consent: { email: 'subscribed' | 'unsubscribed' | null }
  nps: { score: number; band: 'detractor' | 'passive' | 'promoter'; answeredAt: string } | null
  messages: { sent: number; suppressed: number; opened: number; clicked: number }
  recommendations: Array<{ sku: string; name: string; source: 'affinity' | 'bestSeller' }>
  segments?: string[]
  watches?: Array<{
    sku: string
    currencyCode: string
    watchedPriceGross: string | null
    currentPriceGross: string | null
    notifiedAt: string | null
  }>
  referral?: {
    code: string | null
    url: string | null
    claimed: number
    converted: number
    referredBy: { referrerEntityId: string; status: string } | null
  }
  recentScoreEntries: Array<{
    id: string
    points: number
    reason: string | null
    source: string
    occurredAt: string
  }>
  recentRuns: Array<{
    id: string
    campaignId: string
    triggerEventId: string
    status: string
    startedAt: string
    completedAt: string | null
  }>
}

/**
 * The customer profile: one screen for everything this module knows about one person.
 *
 * Read-only on purpose. Every number here is derived — the score from its ledger, the tier from the
 * score, the aggregates from orders — so there is nothing on this page that could be edited without
 * editing the thing it is derived from.
 */
export default function CustomerProfilePage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const customerId = typeof params?.id === 'string' ? params.id : ''

  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [profile, setProfile] = React.useState<Profile | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [busy, setBusy] = React.useState(false)

  /**
   * Hands the person their data as a file.
   *
   * Downloaded rather than rendered: it is a subject access response, which somebody has to be able to send
   * on, and a screen full of JSON is not a thing you can forward to whoever asked.
   */
  const exportData = async () => {
    setBusy(true)
    try {
      const response = await apiCallOrThrow<Record<string, unknown>>(`/api/marketing_automation/customers/${customerId}/gdpr`)
      const blob = new Blob([JSON.stringify(response.result ?? {}, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `marketing-data-${customerId}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      flash(t('marketing_automation.gdpr.exportFailed', 'Could not export the data.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const eraseData = async () => {
    const confirmed = await confirm({
      text: t(
        'marketing_automation.gdpr.confirmErase',
        'Erase this customer marketing data? Their campaign history stays as anonymous rows so past totals remain correct, and their unsubscribe is kept so they are never mailed again.',
      ),
      variant: 'destructive',
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await apiCallOrThrow(`/api/marketing_automation/customers/${customerId}/gdpr`, {
        method: 'POST',
        body: JSON.stringify({ confirm: 'erase' }),
        headers: { 'content-type': 'application/json' },
      })
      flash(t('marketing_automation.gdpr.erased', 'The marketing data has been erased.'), 'success')
      // Reloaded rather than patched: the profile is now a different thing and showing the old numbers
      // beside a success message would suggest the erasure did not work.
      window.location.reload()
    } catch {
      flash(t('marketing_automation.gdpr.eraseFailed', 'Could not erase the data.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  React.useEffect(() => {
    if (!customerId) return
    let cancelled = false
    void (async () => {
      try {
        const response = await apiCall<Profile>(`/api/marketing_automation/customers/${customerId}/profile`)
        if (cancelled) return
        if (response.status === 404) {
          setState('missing')
          return
        }
        if (!response.ok || !response.result) {
          setState('error')
          return
        }
        setProfile(response.result)
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true }
  }, [customerId])

  if (state === 'loading') {
    return <Page><PageBody><LoadingMessage label={t('marketing_automation.profile.loading', 'Loading the profile…')} /></PageBody></Page>
  }
  if (state === 'missing') {
    return (
      <Page><PageBody>
        <RecordNotFoundState
          label={t('marketing_automation.profile.notFound', 'This customer no longer exists.')}
          backHref="/backend/marketing/campaigns"
          backLabel={t('marketing_automation.list.title', 'Campaigns')}
        />
      </PageBody></Page>
    )
  }
  if (state === 'error' || !profile) {
    return <Page><PageBody><ErrorMessage label={t('marketing_automation.profile.loadFailed', 'Could not load the profile.')} /></PageBody></Page>
  }

  const tierLabel = profile.score.tier
    ? t(`marketing_automation.tier.${profile.score.tier}`, profile.score.tier)
    : t('marketing_automation.profile.noTier', 'No tier yet')

  return (
    <Page>
      <PageBody>
        {ConfirmDialogElement}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="text-h3 text-foreground">
            {profile.customer.displayName ?? t('marketing_automation.profile.unnamed', 'Unnamed customer')}
            <div className="text-sm font-normal text-muted-foreground">{profile.customer.email ?? '—'}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void exportData()}>
              {t('marketing_automation.gdpr.export', 'Export data')}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void eraseData()}>
              {t('marketing_automation.gdpr.erase', 'Erase data')}
            </Button>
          </div>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title={t('marketing_automation.profile.kpi.score', 'Lead score')}
            value={profile.score.points}
            footer={
              <span>
                {tierLabel}
                {profile.score.pointsToNext !== null ? (
                  <>
                    {' · '}
                    {t('marketing_automation.profile.pointsToNext', '{count} to the next tier')
                      .replace('{count}', String(profile.score.pointsToNext))}
                  </>
                ) : null}
              </span>
            }
          />
          <KpiCard
            title={t('marketing_automation.profile.kpi.orders', 'Orders')}
            value={profile.orders.count}
            footer={
              <span>
                {profile.orders.daysSinceLast === null
                  ? t('marketing_automation.profile.neverOrdered', 'Never ordered')
                  : t('marketing_automation.profile.daysSinceLast', 'Last order {count} days ago')
                      .replace('{count}', String(profile.orders.daysSinceLast))}
              </span>
            }
          />
          <KpiCard
            title={t('marketing_automation.profile.kpi.spend', 'Lifetime spend')}
            value={profile.orders.totalGross}
          />
          <KpiCard
            title={t('marketing_automation.profile.kpi.nps', 'Latest NPS')}
            value={profile.nps ? profile.nps.score : null}
            footer={
              <span>
                {profile.nps
                  ? `${t(`marketing_automation.nps.band.${profile.nps.band}`, profile.nps.band)} · ${formatDateTime(profile.nps.answeredAt)}`
                  : t('marketing_automation.profile.noNps', 'Never answered a survey')}
              </span>
            }
          />
          <KpiCard
            title={t('marketing_automation.profile.kpi.messages', 'Messages sent')}
            value={profile.messages.sent}
            footer={
              <span>
                {t('marketing_automation.profile.engagement', '{opened} opened · {clicked} clicked')
                  .replace('{opened}', String(profile.messages.opened))
                  .replace('{clicked}', String(profile.messages.clicked))}
              </span>
            }
          />
        </div>

        <div className="mb-6">
          <SectionHeader title={t('marketing_automation.profile.consent', 'Marketing consent')} />
          {/* Three states, and the third one matters: "not recorded" is not the same as "agreed", and a
              screen that showed only a yes/no would invent a decision the customer never made. */}
          <StatusBadge variant={profile.consent.email === 'unsubscribed' ? 'error' : profile.consent.email === 'subscribed' ? 'success' : 'neutral'}>
            {profile.consent.email === 'unsubscribed'
              ? t('marketing_automation.profile.consent.unsubscribed', 'Unsubscribed from email')
              : profile.consent.email === 'subscribed'
                ? t('marketing_automation.profile.consent.subscribed', 'Subscribed to email')
                : t('marketing_automation.profile.consent.unrecorded', 'No email preference recorded')}
          </StatusBadge>
        </div>

        {(profile.watches ?? []).length > 0 ? (
          <div className="mb-6">
            <SectionHeader
              title={t('marketing_automation.profile.watches', 'Waiting for a price drop')}
              count={(profile.watches ?? []).length}
            />
            <ul className="space-y-1">
              {(profile.watches ?? []).map((watch) => (
                <li key={watch.sku} className="flex items-baseline justify-between gap-2 border-b border-border py-1 text-sm">
                  <span className="font-mono text-xs text-foreground">{watch.sku}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {/* Both numbers, because one without the other says nothing: the interesting fact is the
                        distance between what they saw and what it costs now. */}
                    <span className="tabular-nums">
                      {watch.watchedPriceGross
                        ? `${watch.watchedPriceGross} ${watch.currencyCode}`
                        : t('marketing_automation.profile.watchNoReference', 'no price when they started')}
                    </span>
                    <span aria-hidden="true">→</span>
                    <span className="tabular-nums font-medium text-foreground">
                      {watch.currentPriceGross
                        ? `${watch.currentPriceGross} ${watch.currencyCode}`
                        : t('marketing_automation.profile.watchNoPrice', 'not on sale')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mb-6">
          <SectionHeader title={t('marketing_automation.profile.referral', 'Referrals')} />
          {/* Two numbers, because they answer different questions: how many people used the code, and how
              many of those actually bought — which is the one a reward should be based on. */}
          {profile.referral?.code ? (
            <div className="space-y-1 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-foreground">{profile.referral.code}</span>
                {profile.referral.url ? (
                  <a className="text-xs underline text-muted-foreground" href={profile.referral.url}>
                    {t('marketing_automation.profile.referralLink', 'Shared link')}
                  </a>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('marketing_automation.profile.referralCounts', '{claimed} used the code · {converted} went on to buy')
                  .replace('{claimed}', String(profile.referral.claimed))
                  .replace('{converted}', String(profile.referral.converted))}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t('marketing_automation.profile.noReferralCode', 'No referral code yet — a campaign step issues one.')}
            </div>
          )}
          {profile.referral?.referredBy ? (
            <div className="mt-2 text-xs text-muted-foreground">
              {t('marketing_automation.profile.referredBy', 'Referred by another customer ({status})')
                .replace('{status}', t(`marketing_automation.referral.status.${profile.referral.referredBy.status}`, profile.referral.referredBy.status))}
            </div>
          ) : null}
        </div>

        <div className="mb-6">
          <SectionHeader
            title={t('marketing_automation.profile.recommendations', 'What the next message would offer')}
            count={(profile.recommendations ?? []).length}
          />
          {/* The SIGNAL is shown beside each product, because "because people like you bought it" and
              "because everybody buys it" are different promises, and only the first one is personal. */}
          {(profile.recommendations ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t('marketing_automation.profile.noRecommendations', 'Nothing to recommend yet — there are no orders to learn from.')}
            </div>
          ) : (
            <ul className="space-y-1">
              {(profile.recommendations ?? []).map((item) => (
                <li key={item.sku} className="flex items-baseline justify-between gap-2 border-b border-border py-1 text-sm">
                  <span className="truncate text-foreground">{item.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{item.sku}</span>
                    <StatusBadge variant={item.source === 'affinity' ? 'info' : 'neutral'}>
                      {item.source === 'affinity'
                        ? t('marketing_automation.profile.recommendationSource.affinity', 'Bought together')
                        : t('marketing_automation.profile.recommendationSource.bestSeller', 'Best seller')}
                    </StatusBadge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(profile.segments ?? []).length > 0 ? (
          <div className="mb-6">
            <SectionHeader
              title={t('marketing_automation.profile.segments', 'Segments')}
              count={(profile.segments ?? []).length}
            />
            <div className="flex flex-wrap gap-1">
              {(profile.segments ?? []).map((segment) => (
                <span key={segment} className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">{segment}</span>
              ))}
            </div>
          </div>
        ) : null}

        {profile.tags.length > 0 ? (
          <div className="mb-6">
            <SectionHeader title={t('marketing_automation.profile.tags', 'Tags')} />
            <div className="flex flex-wrap gap-1">
              {profile.tags.map((tag) => (
                <span key={tag} className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <SectionHeader
              title={t('marketing_automation.profile.scoreHistory', 'Recent score changes')}
              count={profile.recentScoreEntries.length}
            />
            {profile.recentScoreEntries.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t('marketing_automation.profile.noScoreEntries', 'No points awarded yet.')}
              </div>
            ) : (
              <ul className="space-y-1">
                {profile.recentScoreEntries.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-2 border-b border-border py-1 text-sm">
                    <span className="text-foreground">
                      <span className="tabular-nums font-medium">{entry.points > 0 ? `+${entry.points}` : entry.points}</span>
                      {entry.reason ? <span className="text-muted-foreground"> · {entry.reason}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(entry.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <SectionHeader
              title={t('marketing_automation.profile.recentRuns', 'Recent campaign runs')}
              count={profile.recentRuns.length}
            />
            {profile.recentRuns.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t('marketing_automation.profile.noRuns', 'This customer has not entered a campaign yet.')}
              </div>
            ) : (
              <ul className="space-y-1">
                {profile.recentRuns.map((run) => (
                  <li key={run.id} className="flex items-baseline justify-between gap-2 border-b border-border py-1 text-sm">
                    <a className="truncate text-foreground underline" href={`/backend/marketing/campaigns/${run.campaignId}/runs`}>
                      {run.triggerEventId}
                    </a>
                    <span className="flex shrink-0 items-center gap-2">
                      <StatusBadge variant={RUN_STATUS_VARIANTS[run.status] ?? 'neutral'}>
                        {t(`marketing_automation.runs.status.${run.status}`, run.status)}
                      </StatusBadge>
                      <span className="text-xs text-muted-foreground">{formatDateTime(run.startedAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
