"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { KpiCard } from '@open-mercato/ui/backend/charts'
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
  opened: number
  clicked: number
  clickRate: number | null
  openRate: number | null
}

type Winner = { stepId: string; variant: string; clickRate: number; runnerUpClickRate: number | null; sends: number }

type Results = {
  campaign: { id: string; name: string }
  sends: { sent: number; suppressed: number }
  events: { delivered: number; opened: number; clicked: number; bounced: number }
  uniqueRecipients: { opened: number; clicked: number }
  splits: SplitResult[]
  winners: Winner[]
  attribution: Array<{ campaignId: string; currencyCode: string | null; orders: number; revenue: number }>
  settings: { windowDays: number; minimumSends: number }
}

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`
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
                        {t('marketing_automation.results.notEnoughData', 'Not enough data yet ({count} sends per variant needed)')
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
                        <TableHead>{t('marketing_automation.results.column.openRate', 'Open rate')}</TableHead>
                        <TableHead>{t('marketing_automation.results.column.clickRate', 'Click rate')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lanes.map((laneResult) => (
                        <TableRow key={laneResult.variant}>
                          <TableCell>{laneResult.variant}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{laneResult.runs}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{laneResult.sends}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{formatRate(laneResult.openRate)}</TableCell>
                          <TableCell className="tabular-nums">{formatRate(laneResult.clickRate)}</TableCell>
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
