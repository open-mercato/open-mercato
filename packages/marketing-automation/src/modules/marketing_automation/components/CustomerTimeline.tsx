"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { RecordRow } from './RecordRow'

type TimelineEntry = {
  id: string
  kind: string
  at: string
  campaignId: string | null
  campaignName: string | null
  amount: number | null
  source: string | null
  detail: string | null
  detailKey: string | null
}

type TimelineResponse = { items?: TimelineEntry[]; hasMore?: boolean; nextBefore?: string | null }

const PAGE_SIZE = 25

/**
 * The kinds that describe something going wrong or somebody leaving.
 *
 * Colour carries the one distinction a reader scans for — "is there anything bad in here" — and nothing else,
 * so the list has two tones rather than a palette. Everything else stays in the ordinary foreground: a
 * timeline where every row is coloured is a timeline where colour means nothing.
 */
const NEGATIVE_KINDS = new Set(['unsubscribed', 'failed', 'suppressed'])

export function CustomerTimeline({ customerId }: { customerId: string }) {
  const t = useT()
  const [entries, setEntries] = React.useState<TimelineEntry[]>([])
  const [nextBefore, setNextBefore] = React.useState<string | null>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)

  const load = React.useCallback(async (before: string | null) => {
    setLoading(true)
    setLoadFailed(false)
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (before) query.set('before', before)
    const response = await apiCall<TimelineResponse>(
      `/api/marketing_automation/customers/${customerId}/timeline?${query.toString()}`,
    )
    /**
     * A non-ok response is not an empty history.
     *
     * `apiCall` resolves rather than throwing on 401/403/500, so without this check an expired session would
     * render "nothing has happened to this customer" — which is the most reassuring possible lie about a
     * person somebody is investigating.
     */
    if (!response.ok || !Array.isArray(response.result?.items)) {
      setLoadFailed(true)
      setLoading(false)
      return
    }
    const items = response.result.items
    setEntries((current) => (before ? [...current, ...items] : items))
    setHasMore(Boolean(response.result.hasMore))
    setNextBefore(response.result.nextBefore ?? null)
    setLoading(false)
  }, [customerId])

  React.useEffect(() => { void load(null) }, [load])

  /**
   * One sentence per kind, written out rather than assembled from parts.
   *
   * Composing "Message" + "sent" reads acceptably in English and falls apart in every language with cases or
   * a different word order, which is four of the five this module ships.
   */
  const labelFor = (entry: TimelineEntry): string => {
    switch (entry.kind) {
      case 'entered': return t('marketing_automation.timeline.entered', 'Entered the campaign')
      case 'sent': return t('marketing_automation.timeline.sent', 'Message sent')
      case 'suppressed': return t('marketing_automation.timeline.suppressed', 'Message held back')
      case 'failed': return t('marketing_automation.timeline.failed', 'Message could not be sent')
      case 'opened': return t('marketing_automation.timeline.opened', 'Opened the message')
      case 'clicked': return t('marketing_automation.timeline.clicked', 'Clicked a link')
      case 'points': return entry.amount !== null && entry.amount < 0
        ? t('marketing_automation.timeline.pointsLost', '{count} points').replace('{count}', String(entry.amount))
        : t('marketing_automation.timeline.pointsGained', '+{count} points').replace('{count}', String(entry.amount ?? 0))
      case 'subscribed': return t('marketing_automation.timeline.subscribed', 'Subscribed')
      case 'unsubscribed': return t('marketing_automation.timeline.unsubscribed', 'Unsubscribed')
      case 'nps_asked': return t('marketing_automation.timeline.npsAsked', 'Asked how likely they are to recommend')
      case 'nps_answered': return t('marketing_automation.timeline.npsAnswered', 'Answered {score} out of 10')
        .replace('{score}', String(entry.amount ?? 0))
      case 'referral_sent': return t('marketing_automation.timeline.referralSent', 'Their referral code was used')
      case 'referral_used': return t('marketing_automation.timeline.referralUsed', 'Arrived through a referral')
      case 'inbound': return t('marketing_automation.timeline.inbound', 'An outside system posted about them')
      default: return entry.kind
    }
  }

  if (loading && entries.length === 0) {
    return <LoadingMessage label={t('marketing_automation.timeline.loading', 'Loading what happened…')} />
  }
  if (loadFailed && entries.length === 0) {
    return <ErrorMessage label={t('marketing_automation.timeline.loadFailed', 'Could not load what happened to this customer.')} />
  }
  if (entries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        {t('marketing_automation.timeline.empty', 'Nothing has happened to this customer yet.')}
      </div>
    )
  }

  return (
    <div>
      <ul className="space-y-1">
        {entries.map((entry) => (
          <RecordRow key={entry.id}>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className={NEGATIVE_KINDS.has(entry.kind) ? 'shrink-0 font-medium text-status-error-text' : 'shrink-0 font-medium'}>
                {labelFor(entry)}
              </span>
              {entry.detail ? (
                <span className="truncate text-xs text-muted-foreground">
                  {/* A trigger has a written name; a URL or a reason is already its own words. */}
                  {entry.detailKey ? t(entry.detailKey, entry.detail) : entry.detail}
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {entry.campaignName ? (
                <a className="underline" href={`/backend/marketing/campaigns/${entry.campaignId}/runs`}>
                  {entry.campaignName}
                </a>
              ) : null}
              <span className="tabular-nums">{formatDateTime(entry.at)}</span>
            </span>
          </RecordRow>
        ))}
      </ul>
      {hasMore ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={loading}
          onClick={() => { void load(nextBefore) }}
        >
          {t('marketing_automation.timeline.more', 'Show older')}
        </Button>
      ) : null}
      {loadFailed ? (
        <div className="mt-2 text-xs text-status-error-text">
          {t('marketing_automation.timeline.loadFailed', 'Could not load what happened to this customer.')}
        </div>
      ) : null}
    </div>
  )
}
