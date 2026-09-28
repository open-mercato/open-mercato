"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
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
  messages: { sent: number; suppressed: number; opened: number; clicked: number }
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

  const [profile, setProfile] = React.useState<Profile | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'missing' | 'error'>('loading')

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
        <div className="mb-4">
          <div className="text-h3 text-foreground">
            {profile.customer.displayName ?? t('marketing_automation.profile.unnamed', 'Unnamed customer')}
          </div>
          <div className="text-sm text-muted-foreground">{profile.customer.email ?? '—'}</div>
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
