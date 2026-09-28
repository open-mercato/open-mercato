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
import { loadConsentState } from '../../../../lib/consent.js'
import { loadLatestNps, npsBand } from '../../../../lib/survey.js'
import { resolveTier } from '../../../../lib/engine/tiers.js'
import { loadTierThresholds } from '../../../../lib/tiers.js'

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
  const segments = new URL(req.url).pathname.split('/').filter(Boolean)
  // .../customers/<id>/profile
  return segments[segments.length - 2] ?? null
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
  const engagementRows = await em.getConnection().execute<Array<{ type: string; count: string }>>(
    `select e.type as type, count(distinct e.run_id)::text as count
       from marketing_message_send_events e
       join marketing_campaign_runs r on r.id = e.run_id
      where e.tenant_id = ? and e.organization_id = ? and r.subject_entity_id = ?
      group by e.type`,
    [scope.tenantId, scope.organizationId, customerId],
  )
  const engagement = { opened: 0, clicked: 0 }
  for (const row of engagementRows) {
    const count = Number.parseInt(row.count ?? '0', 10) || 0
    if (row.type === 'opened') engagement.opened = count
    if (row.type === 'clicked') engagement.clicked = count
  }

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
    },
    tags,
    /**
     * Null means nothing is on record, which this module treats as permitted — so the screen says
     * "not recorded" rather than implying a decision the customer never made.
     */
    consent: { email: emailConsent },
    /** Null when they have never answered, which the screen states rather than showing a zero. */
    nps: nps ? { score: nps.score, band: npsBand(nps.score), answeredAt: nps.answeredAt } : null,
    messages: { sent, suppressed, opened: engagement.opened, clicked: engagement.clicked },
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
