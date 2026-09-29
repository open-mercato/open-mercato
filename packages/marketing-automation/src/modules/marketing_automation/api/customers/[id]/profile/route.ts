import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import {
  MarketingCampaignRun,
  MarketingCustomerScoreEntry,
  MarketingMessageSend,
} from '../../../../data/entities.js'
import { loadOrderAggregates, loadTagSlugs } from '../../../../lib/subject-document.js'
import { loadScorePoints } from '../../../../lib/scores.js'
import { recommendForSubject } from '../../../../lib/recommendations.js'
import { loadReferralSummary, loadReferralUrlTemplate } from '../../../../lib/referrals.js'
import { computeSegmentSlugs, loadSegmentDefinitions, namesForSlugs } from '../../../../lib/segments.js'
import { loadWatchSummaries } from '../../../../lib/product-watches.js'
import { loadPreferenceSummary } from '../../../../lib/preferences.js'
import { buildSubjectDocument } from '../../../../lib/subject-document.js'
import { loadConsentState } from '../../../../lib/consent.js'
import { loadLatestNps, npsBand } from '../../../../lib/survey.js'
import { resolveTier } from '../../../../lib/engine/tiers.js'
import { loadTierThresholds } from '../../../../lib/tiers.js'
import { readPathUuid } from '../../../shared.js'

/**
 * Everything this module knows about one customer, on one response.
 *
 * The module already computes all of it — order aggregates for audiences, the score ledger, tags,
 * runs, sends and delivery events — and computing it in four places for four screens is how those
 * numbers start disagreeing. So it is assembled once, here.
 *
 * Gated by BOTH `marketing_automation.runs.view` and `customers.people.view`: it names an
 * identifiable person and reports their behaviour, which is the union of two disclosures rather than
 * either one of them.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view', 'customers.people.view'] },
}

export const metadata = routeMetadata

/** Enough to judge whether the recommendations are sensible, without turning the profile into a catalogue. */
const PROFILE_RECOMMENDATION_COUNT = 5

const RECENT_LIMIT = 10

function readCustomerId(req: Request): string | null {
  // .../customers/<id>/profile
  return readPathUuid(req, 2)
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const customerId = readCustomerId(req)
  if (!customerId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const now = new Date()

  // `display_name` and `primary_email` are encrypted at rest; a plain findOne would hand back
  // ciphertext and the screen would show it.
  const customer = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: customerId, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [tags, orders, points, tierThresholds, emailConsent, nps] = await Promise.all([
    loadTagSlugs(em, customerId, scope),
    loadOrderAggregates(em, customerId, scope, now),
    loadScorePoints(em, customerId, scope),
    loadTierThresholds(container, scope),
    loadConsentState(em, customerId, scope, 'email'),
    loadLatestNps(em, customerId, scope),
  ])
  const tier = resolveTier(points, tierThresholds)

  /**
   * What the next message would offer them.
   *
   * On the profile rather than only inside a send, because a recommendation nobody can inspect is a
   * recommendation nobody will trust: this is where somebody checks that the shop is not about to offer a
   * customer the fridge they bought last week.
   */
  const recommendations = await recommendForSubject(em, scope, customerId, PROFILE_RECOMMENDATION_COUNT)

  /**
   * Their referral code, how many people used it, and who referred them.
   *
   * On the profile because a referral is a fact about a person, and because the operational question — "did
   * this customer actually bring anybody" — is asked while looking at that person.
   */
  /**
   * Which saved segments this customer is in.
   *
   * Computed from a full subject document rather than from the pieces above, which costs a second set of
   * aggregate reads on this one screen. Assembling a partial document would be cheaper and would answer
   * WRONGLY — a segment comparing `orders.daysSinceLast` against a key that was not filled in is a segment
   * this page would silently claim the customer is not in.
   */
  const segmentDefinitions = await loadSegmentDefinitions(em, scope)
  /**
   * Built once and used twice: for segment membership and for the RFM/value card below.
   *
   * It used to be built only when segments existed, and only to be thrown away. RFM needs the same document,
   * so building it unconditionally now costs nothing extra on a screen that already reads these aggregates.
   */
  const document = await buildSubjectDocument(em, customerId, scope, {}, now, { tierThresholds, segments: [] })
  const segments = segmentDefinitions.length > 0
    ? namesForSlugs(segmentDefinitions, computeSegmentSlugs(document, segmentDefinitions, now))
    : []

  /**
   * What they are waiting to get cheaper.
   *
   * The most explicit thing a customer ever tells a shop, so it belongs on the screen where somebody decides
   * what to offer them.
   */
  const watches = await loadWatchSummaries(em, scope, customerId)

  /**
   * What the customer asked for themselves, beside the consent they gave.
   *
   * The two are different facts and the screen shows both: "subscribed, but at most one a week and paused
   * until March" is a customer nobody should be surprised by.
   */
  const preference = await loadPreferenceSummary(em, scope, customerId)

  const referral = await loadReferralSummary(
    em,
    scope,
    customerId,
    await loadReferralUrlTemplate(container, scope),
  )

  const [scoreEntries, runs, sent, suppressed] = await Promise.all([
    em.find(
      MarketingCustomerScoreEntry,
      { ...scope, subjectEntityId: customerId },
      { orderBy: { occurredAt: 'DESC' }, limit: RECENT_LIMIT },
    ),
    em.find(
      MarketingCampaignRun,
      { ...scope, subjectEntityId: customerId },
      { orderBy: { startedAt: 'DESC' }, limit: RECENT_LIMIT },
    ),
    em.count(MarketingMessageSend, { ...scope, subjectEntityId: customerId, status: 'sent' }),
    em.count(MarketingMessageSend, { ...scope, subjectEntityId: customerId, status: 'suppressed' }),
  ])

  /**
   * Engagement across EVERY run of this customer, joined through the run table because a delivery
   * event is keyed to the send rather than to the person — deliberately, so the event table holds no
   * identity of its own.
   *
   * Counted in SQL rather than over the ten runs listed below. Doing it over that page made the
   * profile assert that a customer with forty runs had never engaged, because their opens were on the
   * thirty runs the list did not show — while `sent` beside it was all-time. Two numbers on one line,
   * measured over different populations, is worse than either alone.
   */
  /**
   * Read from the subject DOCUMENT now, not from a query of this screen's own.
   *
   * The same numbers became an audience field, so there are two ways to count them and only one may be
   * authoritative — a profile that disagrees with what an audience selects is the screen people stop trusting.
   * The document's query is the same shape this one was, so no number changes.
   */
  const engagement = document.engagement

  return NextResponse.json({
    customer: {
      id: customer.id,
      displayName: customer.displayName ?? null,
      email: customer.primaryEmail ?? null,
      createdAt: customer.createdAt ? new Date(customer.createdAt).toISOString() : null,
    },
    score: {
      points,
      tier: tier.key,
      tierRank: tier.rank,
      pointsToNext: tier.pointsToNext,
    },
    orders: {
      count: orders.count,
      totalGross: orders.totalGross,
      lastPlacedAt: orders.lastPlacedAt ?? null,
      daysSinceLast: orders.daysSinceLast ?? null,
      firstPlacedAt: orders.firstPlacedAt ?? null,
      averageGross: orders.averageGross ?? null,
      /** What they buy, as category slugs — the audience path, so the screen teaches the vocabulary. */
      categories: document.orders.categories,
    },
    /**
     * RFM and the value projection, both NULL until they mean something.
     *
     * Null for a customer who has never ordered and for a shop with too few buyers to rank against — a 1-1-1
     * for somebody with no orders would read as "our worst customer" rather than "not a customer yet". The
     * screen says which of the two it is.
     */
    rfm: document.rfm,
    value: document.value,
    tags,
    /**
     * Null means nothing is on record, which this module treats as permitted — so the screen says
     * "not recorded" rather than implying a decision the customer never made.
     */
    consent: { email: emailConsent },
    /** Their own limits, set in the portal preference centre. Nulls mean they have expressed none. */
    preference,
    /** Null when they have never answered, which the screen states rather than showing a zero. */
    nps: nps ? { score: nps.score, band: npsBand(nps.score), answeredAt: nps.answeredAt } : null,
    messages: {
      sent,
      suppressed,
      opened: engagement.opened,
      clicked: engagement.clicked,
      /**
       * How long since any sign of life — the number a sunset audience acts on, so the screen shows what the
       * campaign will see. Null when nobody has ever written to them, which is not the same as silence.
       */
      daysSinceEngaged: engagement.daysSinceEngaged ?? null,
      lastEngagedAt: engagement.lastEngagedAt ?? null,
    },
    /** Segment NAMES, not slugs: the slug is a reference for audiences, the name is for people. */
    segments,
    /** Each carries the price they last saw and the price now, which is the whole point of a watch. */
    watches,
    /** `code` is null until a campaign step has issued one, which the screen says plainly. */
    referral,
    /** Each carries the signal that chose it, so the screen can say why rather than just what. */
    recommendations: recommendations.map((item) => ({ sku: item.sku, name: item.name, source: item.source })),
    recentScoreEntries: scoreEntries.map((entry) => ({
      id: entry.id,
      points: entry.points,
      reason: entry.reason ?? null,
      source: entry.source,
      campaignId: entry.campaignId ?? null,
      occurredAt: entry.occurredAt.toISOString(),
    })),
    recentRuns: runs.map((run) => ({
      id: run.id,
      campaignId: run.campaignId,
      triggerEventId: run.triggerEventId,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    })),
  })
}

export const openApi = {
  GET: {
    summary: 'Everything marketing automation knows about one customer',
    description:
      'Score and tier, order aggregates, tags, message and engagement counts, what the next message would recommend to them, and the most recent score entries and campaign runs. Requires both `marketing_automation.runs.view` and `customers.people.view`, because it names a person and reports their behaviour.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The profile' }, 404: { description: 'Not found' } },
  },
}
