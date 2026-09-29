"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { BarChart, KpiCard, LineChart } from '@open-mercato/ui/backend/charts'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SplitResult = {
  stepId: string
  variant: string
  runs: number
  sends: number
  reached: number
  hasSteps: boolean
  opened: number
  clicked: number
  clickRate: number | null
  openRate: number | null
  revenue: number | null
  currencyCode: string | null
  mixedCurrency: boolean
  revenuePerRecipient: number | null
}

type Winner = {
  stepId: string
  variant: string
  metric: 'clicks' | 'revenue'
  value: number
  runnerUpValue: number | null
  clickRate: number
  runnerUpClickRate: number | null
  sends: number
  reached: number
}

type DailyPoint = { date: string; sent: number; opened: number; clicked: number }

type LinkRow = {
  url: string
  people: number
  clicks: number
  shareOfClickers: number | null
  stepIds: string[]
}

type FunnelStage = {
  key: string
  people: number
  conversionFromPrevious: number | null
  shareOfEntered: number | null
}

type Results = {
  campaign: { id: string; name: string }
  sends: { sent: number; suppressed: number }
  funnel: { stages: FunnelStage[]; hasEngagementData: boolean }
  events: { delivered: number; opened: number; clicked: number; bounced: number }
  uniqueRecipients: { opened: number; clicked: number }
  splits: SplitResult[]
  daily: DailyPoint[]
  links: { links: LinkRow[]; clickers: number; truncated: boolean }
  winners: Winner[]
  attribution: Array<{ campaignId: string; currencyCode: string | null; orders: number; revenue: number }>
  settings: { windowDays: number; minimumSends: number; winnerMetric: 'clicks' | 'revenue' }
}

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`
}

/**
 * Money with its currency, or a dash.
 *
 * Never a bare number: a lane's figure is meaningless without the code beside it, and null means nothing has
 * been attributed yet rather than that nothing was earned.
 */
function formatMoney(amount: number | null, currencyCode: string | null): string {
  if (amount === null) return '—'
  return currencyCode ? `${currencyCode} ${amount.toFixed(2)}` : amount.toFixed(2)
}

/**
 * What a campaign actually achieved.
 *
 * Every number here is read from recorded facts — the lane stored on each run, the delivery events, the
 * orders placed after a click — rather than computed twice in two screens. The A/B section is the only
 * part with an ACTION, and it is deliberately one click behind a suggestion: the server decides whether
 * a variant has earned the name "winner", the author decides whether to end the test.
 */
export default function CampaignResultsPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const campaignId = typeof params?.id === 'string' ? params.id : ''

  const [results, setResults] = React.useState<Results | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [applying, setApplying] = React.useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = React.useState('')

  const load = React.useCallback(async () => {
    try {
      const [report, campaign] = await Promise.all([
        apiCall<Results>(`/api/marketing_automation/campaigns/${campaignId}/tracking`),
        apiCall<{ updatedAt?: string }>(`/api/marketing_automation/campaigns/${campaignId}`),
      ])
      if (!report.ok || !report.result) {
        setState('error')
        return
      }
      setResults(report.result)
      // Needed to promote a winner: the write collides with a concurrent edit exactly as a save does.
      setUpdatedAt(campaign.result?.updatedAt ?? '')
      setState('ready')
    } catch {
      setState('error')
    }
  }, [campaignId])

  React.useEffect(() => {
    if (!campaignId) return
    void load()
  }, [campaignId, load])

  const applyWinner = async (winner: Winner) => {
    setApplying(winner.stepId)
    try {
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(updatedAt),
        () => apiCallOrThrow(`/api/marketing_automation/campaigns/${campaignId}/apply-split-winner`, {
          method: 'POST',
          body: JSON.stringify({ updatedAt, stepId: winner.stepId, variantKey: winner.variant }),
          headers: { 'content-type': 'application/json' },
        }),
      )
      flash(
        t('marketing_automation.results.winnerApplied', 'Variant {key} is now the only path.').replace('{key}', winner.variant),
        'success',
      )
      await load()
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) {
        flash(t('marketing_automation.results.applyFailed', 'Could not promote the variant.'), 'error')
      }
    } finally {
      setApplying(null)
    }
  }

  if (state === 'loading') {
    return <Page><PageBody><LoadingMessage label={t('marketing_automation.results.loading', 'Loading results…')} /></PageBody></Page>
  }
  if (state === 'error' || !results) {
    return <Page><PageBody><ErrorMessage label={t('marketing_automation.results.loadFailed', 'Could not load the results.')} /></PageBody></Page>
  }

  const splitSteps = [...new Set(results.splits.map((result) => result.stepId))]
  const winnerFor = (stepId: string) => results.winners.find((winner) => winner.stepId === stepId) ?? null

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <div className="text-h3 text-foreground">{results.campaign.name}</div>
          <a className="text-sm underline" href={`/backend/marketing/campaigns/${campaignId}/runs`}>
            {t('marketing_automation.runs.title', 'Runs')}
          </a>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title={t('marketing_automation.results.kpi.sent', 'Sent')}
            value={results.sends.sent}
            footer={
              results.sends.suppressed > 0 ? (
                <span>
                  {t('marketing_automation.results.suppressed', '{count} held back by send rules')
                    .replace('{count}', String(results.sends.suppressed))}
                </span>
              ) : undefined
            }
          />
          <KpiCard
            title={t('marketing_automation.results.kpi.opened', 'Opened')}
            value={results.uniqueRecipients.opened}
            footer={<span>{t('marketing_automation.results.uniqueNote', 'unique recipients')}</span>}
          />
          <KpiCard
            title={t('marketing_automation.results.kpi.clicked', 'Clicked')}
            value={results.uniqueRecipients.clicked}
            footer={<span>{t('marketing_automation.results.uniqueNote', 'unique recipients')}</span>}
          />
          <KpiCard
            title={t('marketing_automation.results.kpi.revenue', 'Attributed revenue')}
            value={results.attribution.length > 0 ? results.attribution[0].revenue : 0}
            footer={
              <span>
                {results.attribution.length > 0 && results.attribution[0].currencyCode
                  ? `${results.attribution[0].currencyCode} · `
                  : ''}
                {t('marketing_automation.results.attributionNote', 'linear split, {days}-day window')
                  .replace('{days}', String(results.settings.windowDays))}
              </span>
            }
          />
        </div>

        {/*
          The funnel, first, because it is the shape of the answer: how many people entered and where they
          stopped. Drawn only once somebody has entered the campaign — five empty bars read as a broken
          campaign rather than one that has not run.
        */}
        {(results.funnel?.stages?.[0]?.people ?? 0) > 0 ? (
          <div className="mb-6">
            <SectionHeader title={t('marketing_automation.results.funnel', 'Funnel')} />
            {/* The distinction is the whole reason the numbers are trustworthy, so it is stated on the screen. */}
            <div className="mb-2 text-xs text-muted-foreground">
              {t(
                'marketing_automation.results.funnelHint',
                'People, not messages — one person going through the campaign once counts once at each stage.',
              )}
            </div>
            <BarChart
              data={results.funnel.stages.map((stage) => ({
                stage: t(`marketing_automation.results.funnel.${stage.key}`, stage.key),
                people: stage.people,
              }))}
              index="stage"
              categories={['people']}
              categoryLabels={{ people: t('marketing_automation.results.funnel.people', 'People') }}
              layout="horizontal"
              emptyMessage={t('marketing_automation.results.noActivity', 'Nothing has been sent yet.')}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('marketing_automation.results.funnel.stage', 'Stage')}</TableHead>
                  <TableHead>{t('marketing_automation.results.funnel.people', 'People')}</TableHead>
                  <TableHead>{t('marketing_automation.results.funnel.fromPrevious', 'From previous')}</TableHead>
                  <TableHead>{t('marketing_automation.results.funnel.ofEntered', 'Of everyone who entered')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.funnel.stages.map((stage) => (
                  <TableRow key={stage.key}>
                    <TableCell>{t(`marketing_automation.results.funnel.${stage.key}`, stage.key)}</TableCell>
                    <TableCell className="tabular-nums">{stage.people}</TableCell>
                    {/* Both denominators, because operators quote both and would otherwise compute one wrongly. */}
                    <TableCell className="tabular-nums text-muted-foreground">{formatRate(stage.conversionFromPrevious)}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{formatRate(stage.shareOfEntered)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {results.funnel.hasEngagementData ? null : (
              <div className="mt-2 text-xs text-muted-foreground">
                {t(
                  'marketing_automation.results.funnelUntracked',
                  'No opens or clicks are on record for this campaign — if its messages were sent with tracking switched off, the stages below "sent" cannot be measured.',
                )}
              </div>
            )}
          </div>
        ) : null}

        {/* The chart is only drawn once something has happened: an empty 90-day line is a worse answer
            than saying nothing, because it looks like a campaign that failed rather than one that has
            not run. */}
        {results.daily.some((point) => point.sent > 0 || point.opened > 0 || point.clicked > 0) ? (
          <div className="mb-6">
            <SectionHeader title={t('marketing_automation.results.overTime', 'Over time')} />
            <LineChart
              data={results.daily as unknown as Record<string, string | number | null>[]}
              index="date"
              categories={['sent', 'opened', 'clicked']}
              categoryLabels={{
                sent: t('marketing_automation.results.kpi.sent', 'Sent'),
                opened: t('marketing_automation.results.kpi.opened', 'Opened'),
                clicked: t('marketing_automation.results.kpi.clicked', 'Clicked'),
              }}
              curveType="monotone"
              showLegend
              emptyMessage={t('marketing_automation.results.noActivity', 'Nothing has been sent yet.')}
            />
          </div>
        ) : null}

        {results.attribution.length > 1 ? (
          <div className="mb-6">
            <SectionHeader title={t('marketing_automation.results.byCurrency', 'Attributed revenue by currency')} />
            <ul className="space-y-1">
              {results.attribution.map((row) => (
                <li key={`${row.campaignId}-${row.currencyCode}`} className="flex justify-between border-b border-border py-1 text-sm">
                  <span className="text-muted-foreground">{row.currencyCode ?? '—'}</span>
                  <span className="tabular-nums text-foreground">
                    {row.revenue} · {t('marketing_automation.results.orders', '{count} orders').replace('{count}', String(row.orders))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/*
          * What they clicked, which `link_url` recorded from the first tracked click and nothing read.
          *
          * Drawn only once there is something to rank: an empty table here would say "nobody clicked" in a
          * campaign that simply has not been sent, which the KPI row above already answers better.
          */}
        {results.links.links.length > 0 ? (
          <div className="mb-6">
            <SectionHeader
              title={t('marketing_automation.results.links', 'What they clicked')}
              count={results.links.links.length}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('marketing_automation.results.column.link', 'Link')}</TableHead>
                  <TableHead>{t('marketing_automation.results.column.people', 'People')}</TableHead>
                  <TableHead>{t('marketing_automation.results.column.clicks', 'Clicks')}</TableHead>
                  <TableHead>{t('marketing_automation.results.column.shareOfClickers', 'Of everyone who clicked')}</TableHead>
                  <TableHead>{t('marketing_automation.results.column.fromStep', 'From')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.links.links.map((link) => (
                  <TableRow key={link.url}>
                    {/* The URL as authored. Shown as text, never as a link: it is a historical record of a
                        message, and an admin screen is not the place to follow somebody else's redirect. */}
                    <TableCell className="max-w-md truncate font-mono text-xs" title={link.url}>{link.url}</TableCell>
                    <TableCell className="tabular-nums">{link.people}</TableCell>
                    {/* Clicks above people is the interesting case: a link somebody came back to. */}
                    <TableCell className="tabular-nums text-muted-foreground">{link.clicks}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{formatRate(link.shareOfClickers)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{link.stepIds.join(', ')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-2 text-xs text-muted-foreground">
              {/* The shares overlap, so they sum past 100% whenever anybody clicked two links. Said once here
                  rather than left for somebody to discover while adding them up. */}
              {t(
                'marketing_automation.results.linksHint',
                'Counted in people, so one recipient clicking four times is one person. The shares are of everyone who clicked anything in this campaign, and overlap: somebody who clicked two links is counted in both.',
              )}
              {results.links.truncated
                ? ` ${t('marketing_automation.results.linksTruncated', 'Only the most-clicked links are listed.')}`
                : ''}
            </div>
          </div>
        ) : null}

        <SectionHeader
          title={t('marketing_automation.results.splits', 'A/B results')}
          count={splitSteps.length}
        />
        {splitSteps.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t('marketing_automation.results.noSplits', 'This campaign has no A/B split, or nobody has entered one yet.')}
          </div>
        ) : (
          <div className="space-y-4">
            {splitSteps.map((stepId) => {
              const lanes = results.splits.filter((result) => result.stepId === stepId)
              const winner = winnerFor(stepId)
              return (
                <div key={stepId} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{stepId}</span>
                    {winner ? (
                      <div className="flex items-center gap-2">
                        <StatusBadge variant="success">
                          {t('marketing_automation.results.winner', 'Variant {key} leads')
                            .replace('{key}', winner.variant)}
                        </StatusBadge>
                        {/* Which question produced the verdict, because "leads" alone hides the one that matters. */}
                        <span className="text-xs text-muted-foreground">
                          {winner.metric === 'revenue'
                            ? t('marketing_automation.results.judgedOnRevenue', 'on revenue per recipient')
                            : t('marketing_automation.results.judgedOnClicks', 'on clicks per recipient')}
                        </span>
                        <Button
                          size="sm"
                          disabled={applying !== null || !updatedAt}
                          onClick={() => void applyWinner(winner)}
                        >
                          {t('marketing_automation.results.applyWinner', 'End the test, keep this variant')}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {/*
                          * A revenue test can also be withheld for a reason that is not the sample: two lanes
                          * earning in different currencies have no ordering, and saying "not enough data" for that
                          * would send somebody looking for recipients they already have.
                          */}
                        {results.settings.winnerMetric === 'revenue' && lanes.some((lane) => lane.mixedCurrency)
                          ? t('marketing_automation.results.mixedCurrency', 'No revenue verdict: these lanes earn in more than one currency, which cannot be compared.')
                          : t('marketing_automation.results.notEnoughData', 'Not enough data yet ({count} recipients per variant needed)')
                            .replace('{count}', String(results.settings.minimumSends))}
                      </span>
                    )}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('marketing_automation.results.column.variant', 'Variant')}</TableHead>
                        <TableHead>{t('marketing_automation.results.column.entered', 'Entered')}</TableHead>
                        <TableHead>{t('marketing_automation.results.column.sent', 'Sent')}</TableHead>
                        <TableHead>{t('marketing_automation.results.column.reached', 'Reached')}</TableHead>
                        <TableHead>{t('marketing_automation.results.column.openRate', 'Open rate')}</TableHead>
                        <TableHead>{t('marketing_automation.results.column.clickRate', 'Click rate')}</TableHead>
                        <TableHead>{t('marketing_automation.results.column.revenue', 'Revenue')}</TableHead>
                        <TableHead>{t('marketing_automation.results.column.revenuePerRecipient', 'Per recipient')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lanes.map((laneResult) => (
                        <TableRow key={laneResult.variant}>
                          <TableCell>
                            {laneResult.variant}
                            {/* A holdout sends nothing on purpose; without saying so its empty row reads as missing data. */}
                            {laneResult.hasSteps ? null : (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {t('marketing_automation.results.holdout', 'control — sends nothing')}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{laneResult.runs}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{laneResult.sends}</TableCell>
                          {/* The denominator of both rates: people, not messages. */}
                          <TableCell className="tabular-nums text-muted-foreground">{laneResult.reached}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{formatRate(laneResult.openRate)}</TableCell>
                          <TableCell className={results.settings.winnerMetric === 'revenue' ? 'tabular-nums text-muted-foreground' : 'tabular-nums'}>
                            {formatRate(laneResult.clickRate)}
                          </TableCell>
                          {/*
                            * What the lane's own messages earned, attributed over the same window as the revenue
                            * block above — so a lane that collects clicks and sells less is visible here rather
                            * than only in whichever total somebody reconciles later.
                            */}
                          <TableCell className="tabular-nums text-muted-foreground">
                            {formatMoney(laneResult.revenue, laneResult.currencyCode)}
                            {laneResult.mixedCurrency ? (
                              <span className="ml-2 text-xs">
                                {t('marketing_automation.results.multiCurrency', 'mixed currencies')}
                              </span>
                            ) : null}
                          </TableCell>
                          {/* The figure a revenue verdict is made on: earnings divided by people, never by messages. */}
                          <TableCell className={results.settings.winnerMetric === 'revenue' ? 'tabular-nums' : 'tabular-nums text-muted-foreground'}>
                            {formatMoney(laneResult.revenuePerRecipient, laneResult.currencyCode)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            })}
          </div>
        )}
      </PageBody>
    </Page>
  )
}
