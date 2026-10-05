import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  MarketingCampaign,
  MarketingCampaignRun,
  MarketingConsentEvent,
  MarketingCustomerScoreEntry,
  MarketingInboundRequest,
  MarketingMessageSend,
  MarketingMessageSendEvent,
  MarketingReferralRedemption,
  MarketingSurveyPrompt,
} from '../../../../data/entities.js'
import { findTrigger } from '../../../../lib/trigger-catalog.js'
import { readPathUuid } from '../../../shared.js'

/**
 * What happened to one person, in order.
 *
 * The profile answers "what is true about them now" — score, tier, RFM, consent, what the next message would
 * offer. This answers the other half of the same question: what we actually did to them and what they did
 * back. Support needs it to settle "I never heard from you" and "I unsubscribed weeks ago", and neither is
 * answerable from a set of current values.
 *
 * **Assembled from the tables that already record it, with no table of its own.** Every entry below is a row
 * somebody already writes on the path that causes it — a run when they enter, a send when a message goes, a
 * delivery event when they open or click, a ledger entry when points are awarded. A timeline table would be a
 * second place the same fact is written, by a different code path than the one that performs it, which is how
 * a timeline starts disagreeing with the screens around it.
 *
 * Gated like the profile, by BOTH `marketing_automation.runs.view` and `customers.people.view`: it names an
 * identifiable person and reports their behaviour.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view', 'customers.people.view'] },
}

export const metadata = routeMetadata

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/**
 * How many of this person's runs are consulted when collecting delivery events.
 *
 * Opens and clicks carry a run id rather than a subject id, so they are reached through the subject's runs.
 * The cap stops a customer with a pathological number of runs from building an unbounded `IN (…)`; it is far
 * above any real journey count, and the newest runs are the ones a timeline page is reading anyway.
 */
const RUN_LOOKUP_CAP = 500

/** What kind of thing happened. The UI maps each to its own wording and tone. */
export type TimelineKind =
  | 'entered'
  | 'sent'
  | 'suppressed'
  | 'failed'
  | 'opened'
  | 'clicked'
  | 'points'
  | 'subscribed'
  | 'unsubscribed'
  | 'nps_asked'
  | 'nps_answered'
  | 'referral_sent'
  | 'referral_used'
  | 'inbound'

export type TimelineEntry = {
  /** Stable across pages: the kind and the row it came from, so React keys and de-duplication both work. */
  id: string
  kind: TimelineKind
  /** ISO. The one field every source is sorted and paged by. */
  at: string
  campaignId: string | null
  campaignName: string | null
  /** Whatever this kind counts: points awarded, an NPS score. Null when the kind counts nothing. */
  amount: number | null
  /**
   * Who or what caused it, where the source records that: `customer`, `operator` or `import` for a consent
   * change, `campaign`, `manual` or `rule` for points. It is a separate field rather than part of `detail`
   * because "they unsubscribed" and "somebody here unsubscribed them" are different events to a reader.
   */
  source: string | null
  /** The clicked URL, the reason a message was held back, the question that was asked. */
  detail: string | null
  /**
   * A translation key for `detail`, where the thing described has a written name.
   *
   * A trigger is the case that forces it: the run stores `customers.person.created`, and printing that at a
   * person is the same mistake the run list made before it learned to say "Customer registered". The caller
   * translates with `detail` as the fallback, so a trigger contributed by a module with no copy still reads.
   */
  detailKey: string | null
}

function readCustomerId(req: Request): string | null {
  // .../customers/<id>/timeline
  return readPathUuid(req, 2)
}

function readLimit(url: URL): number {
  const raw = Number(url.searchParams.get('limit'))
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT
  return Math.min(Math.trunc(raw), MAX_LIMIT)
}

/**
 * The cursor, as an instant rather than an offset.
 *
 * An offset over a merged stream is wrong the moment anything is written between two pages — the reader
 * either sees a row twice or misses one. "Everything older than this" cannot drift.
 */
function readBefore(url: URL): Date | null {
  const raw = url.searchParams.get('before')
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const customerId = readCustomerId(req)
  if (!customerId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }
  const url = new URL(req.url)
  const limit = readLimit(url)
  const before = readBefore(url)

  // One more than asked for, from every source: that is what makes `hasMore` an answer rather than a guess.
  const page = limit + 1
  const olderThan = <T extends string>(field: T) => (before ? { [field]: { $lt: before } } : {})

  const runs = await em.find(
    MarketingCampaignRun,
    { subjectEntityId: customerId, ...scope },
    { orderBy: { startedAt: 'DESC' }, limit: RUN_LOOKUP_CAP },
  )
  const runIds = runs.map((run) => run.id)
  const campaignIdOfRun = new Map(runs.map((run) => [run.id, run.campaignId]))

  const [sends, events, points, consents, surveys, referrals, inbound] = await Promise.all([
    em.find(
      MarketingMessageSend,
      { subjectEntityId: customerId, ...scope, ...olderThan('sentAt') },
      { orderBy: { sentAt: 'DESC' }, limit: page },
    ),
    runIds.length === 0 ? Promise.resolve([]) : em.find(
      MarketingMessageSendEvent,
      { runId: { $in: runIds }, ...scope, type: { $in: ['opened', 'clicked'] }, ...olderThan('occurredAt') },
      { orderBy: { occurredAt: 'DESC' }, limit: page },
    ),
    em.find(
      MarketingCustomerScoreEntry,
      { subjectEntityId: customerId, ...scope, ...olderThan('occurredAt') },
      { orderBy: { occurredAt: 'DESC' }, limit: page },
    ),
    em.find(
      MarketingConsentEvent,
      { subjectEntityId: customerId, ...scope, ...olderThan('occurredAt') },
      { orderBy: { occurredAt: 'DESC' }, limit: page },
    ),
    // `comment` is encrypted at rest, and it is the only thing on this timeline the customer wrote themselves.
    findWithDecryption(
      em,
      MarketingSurveyPrompt,
      { subjectEntityId: customerId, ...scope },
      { orderBy: { askedAt: 'DESC' }, limit: page },
      scope,
    ),
    em.find(
      MarketingReferralRedemption,
      { $or: [{ referrerEntityId: customerId }, { referredEntityId: customerId }], ...scope, ...olderThan('createdAt') },
      { orderBy: { createdAt: 'DESC' }, limit: page },
    ),
    em.find(
      MarketingInboundRequest,
      { subjectEntityId: customerId, ...scope, ...olderThan('receivedAt') },
      { orderBy: { receivedAt: 'DESC' }, limit: page },
    ),
  ])

  const entries: TimelineEntry[] = []
  const add = (entry: TimelineEntry): void => {
    if (before && new Date(entry.at).getTime() >= before.getTime()) return
    entries.push(entry)
  }

  for (const run of runs) {
    add({
      id: `entered:${run.id}`,
      kind: 'entered',
      at: run.startedAt.toISOString(),
      campaignId: run.campaignId,
      campaignName: null,
      amount: null,
      source: null,
      detail: run.triggerEventId,
      detailKey: findTrigger(run.triggerEventId)?.labelKey ?? null,
    })
  }

  for (const send of sends) {
    add({
      id: `send:${send.id}`,
      kind: send.status === 'sent' ? 'sent' : send.status === 'suppressed' ? 'suppressed' : 'failed',
      at: send.sentAt.toISOString(),
      campaignId: send.campaignId ?? null,
      campaignName: null,
      amount: null,
      source: null,
      detail: send.suppressionReason ?? null,
      detailKey: null,
    })
  }

  for (const event of events) {
    add({
      id: `event:${event.id}`,
      kind: event.type === 'clicked' ? 'clicked' : 'opened',
      at: event.occurredAt.toISOString(),
      campaignId: event.campaignId ?? campaignIdOfRun.get(event.runId) ?? null,
      campaignName: null,
      amount: null,
      source: null,
      detail: event.linkUrl ?? null,
      detailKey: null,
    })
  }

  for (const entry of points) {
    add({
      id: `points:${entry.id}`,
      kind: 'points',
      at: entry.occurredAt.toISOString(),
      campaignId: entry.campaignId ?? null,
      campaignName: null,
      amount: entry.points,
      source: entry.source,
      detail: entry.reason ?? null,
      detailKey: null,
    })
  }

  for (const consent of consents) {
    add({
      id: `consent:${consent.id}`,
      kind: consent.state === 'unsubscribed' ? 'unsubscribed' : 'subscribed',
      at: consent.occurredAt.toISOString(),
      campaignId: consent.campaignId ?? null,
      campaignName: null,
      amount: null,
      source: consent.source,
      detail: consent.reason ?? null,
      detailKey: null,
    })
  }

  for (const survey of surveys) {
    add({
      id: `nps_asked:${survey.id}`,
      kind: 'nps_asked',
      at: survey.askedAt.toISOString(),
      campaignId: survey.campaignId,
      campaignName: null,
      amount: null,
      source: null,
      detail: survey.question,
      detailKey: null,
    })
    // Answered is its own entry, because the gap between asking and answering is itself the interesting part.
    if (survey.answeredAt && survey.score !== null && survey.score !== undefined) {
      add({
        id: `nps_answered:${survey.id}`,
        kind: 'nps_answered',
        at: survey.answeredAt.toISOString(),
        campaignId: survey.campaignId,
        campaignName: null,
        amount: survey.score,
        source: null,
        detail: survey.comment ?? null,
        detailKey: null,
      })
    }
  }

  for (const referral of referrals) {
    add({
      id: `referral:${referral.id}`,
      // Which side of the referral this person is on is the whole meaning of the row, so it is the kind
      // rather than something a reader has to decode out of a detail string.
      kind: referral.referrerEntityId === customerId ? 'referral_sent' : 'referral_used',
      at: (referral.convertedAt ?? referral.createdAt).toISOString(),
      campaignId: null,
      campaignName: null,
      amount: null,
      source: null,
      detail: referral.status,
      detailKey: null,
    })
  }

  for (const request of inbound) {
    add({
      id: `inbound:${request.id}`,
      kind: 'inbound',
      at: request.receivedAt.toISOString(),
      campaignId: null,
      campaignName: null,
      amount: null,
      source: null,
      detail: request.outcome,
      detailKey: null,
    })
  }

  entries.sort((left, right) => right.at.localeCompare(left.at))
  const pageEntries = entries.slice(0, limit)

  /**
   * Names resolved for the page only.
   *
   * Every source carries a campaign id and none carries a name, so one lookup over the ids actually being
   * returned is cheaper than joining a campaign to each of seven queries — and it cannot disagree with
   * itself the way seven joins can.
   */
  const campaignIds = [...new Set(pageEntries.map((entry) => entry.campaignId).filter((id): id is string => !!id))]
  if (campaignIds.length > 0) {
    const campaigns = await em.find(MarketingCampaign, { id: { $in: campaignIds }, ...scope })
    const nameOf = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]))
    for (const entry of pageEntries) {
      entry.campaignName = entry.campaignId ? nameOf.get(entry.campaignId) ?? null : null
    }
  }

  return NextResponse.json({
    items: pageEntries,
    hasMore: entries.length > limit,
    /** Pass back as `before` for the next page. Null when this page is the end of the stream. */
    nextBefore: entries.length > limit ? pageEntries[pageEntries.length - 1]?.at ?? null : null,
  })
}

export const openApi = {
  GET: {
    summary: 'Everything this module recorded about one customer, newest first',
    description:
      'Merges the rows that already record what happened — runs entered, messages sent or held back, opens and clicks, score ledger entries, consent changes, NPS prompts and answers, referrals and inbound requests — into one stream ordered by time. Paged by an instant (`before`) rather than an offset, so a write between two pages cannot duplicate or skip a row. Gated by `marketing_automation.runs.view` and `customers.people.view`.',
  },
}
