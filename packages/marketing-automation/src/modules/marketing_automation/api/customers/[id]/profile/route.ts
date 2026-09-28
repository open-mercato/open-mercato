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
  MarketingMessageSendEvent,
} from '../../../../data/entities.js'
import { loadOrderAggregates, loadTagSlugs } from '../../../../lib/subject-document.js'
import { loadScorePoints } from '../../../../lib/scores.js'
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

  const [tags, orders, points, tierThresholds] = await Promise.all([
    loadTagSlugs(em, customerId, scope),
    loadOrderAggregates(em, customerId, scope, now),
    loadScorePoints(em, customerId, scope),
    loadTierThresholds(container, scope),
  ])
  const tier = resolveTier(points, tierThresholds)

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

  // Engagement is counted through this customer's runs, because a delivery event is keyed to the
  // send rather than to the person — deliberately, so the event table holds no identity of its own.
  const runIds = runs.map((run) => run.id)
  const engagement = { opened: 0, clicked: 0 }
  if (runIds.length > 0) {
    const events = await em.find(MarketingMessageSendEvent, { ...scope, runId: { $in: runIds } })
    for (const event of events) {
      if (event.type === 'opened') engagement.opened += 1
      if (event.type === 'clicked') engagement.clicked += 1
    }
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
    messages: { sent, suppressed, opened: engagement.opened, clicked: engagement.clicked },
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
      'Score and tier, order aggregates, tags, message and engagement counts, and the most recent score entries and campaign runs. Requires both `marketing_automation.runs.view` and `customers.people.view`, because it names a person and reports their behaviour.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The profile' }, 404: { description: 'Not found' } },
  },
}
