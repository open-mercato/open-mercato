import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { findScheduledCampaigns } from '../lib/campaign-lookup.js'
import { readDefinition, startCampaignForSubject } from '../lib/dispatcher.js'
import type { DispatchDeps, ReentryPolicy } from '../lib/dispatcher.js'
import { buildSubjectDocument } from '../lib/subject-document.js'
import { describeNarrowing, planNarrowing } from '../lib/engine/narrowing.js'
import { createSqlCandidateSource, resolveCandidates } from '../lib/audience/set-resolver.js'
import { EXPIRING_QUOTE_TRIGGER_ID } from '../lib/trigger-catalog.js'
import { isSweepDue } from '../lib/sweep-interval.js'
import { MarketingCampaignTrigger as TriggerEntity } from '../data/entities.js'
import type { MarketingCampaign, MarketingCampaignTrigger } from '../data/entities.js'
import type { SweepJob } from '../lib/queue.js'
import { buildDispatchDeps, logger, readScope } from './shared.js'
import type { HandlerContext, JobScope } from './shared.js'
import { reportError } from '@open-mercato/telemetry'

// See the note in dispatch.ts: this string must stay a literal.
export const metadata: WorkerMeta = {
  queue: 'marketing-automation-sweep',
  id: 'marketing_automation:sweep',
  concurrency: 1,
  schedulerSafe: true,
  schedulerRequiredFeatures: ['marketing_automation.campaigns.manage'],
}

/**
 * Keyset rather than offset: the candidate set is mutated while the sweep runs, so an offset
 * page would skip or repeat rows. `customer_entities` has a partial index on
 * `(tenant_id, organization_id, id) where deleted_at is null and kind = 'person'`, which is
 * exactly an id-ordered keyset.
 */
const PAGE_SIZE = 200
const DEFAULT_EXPIRY_WINDOW_DAYS = 7

function reentryPolicyFor(trigger: MarketingCampaignTrigger): ReentryPolicy {
  return trigger.reentryAfterDays == null
    ? { kind: 'once' }
    : { kind: 'cooldown', afterDays: trigger.reentryAfterDays }
}

/**
 * Projects one candidate and enrols it if the audience accepts.
 *
 * Shared by both paths below so that narrowing can only ever change WHICH customers are considered,
 * never what happens to one — `matchesAudience` inside `startCampaignForSubject` stays the sole
 * authority on membership.
 */
async function startForCandidate(
  campaign: MarketingCampaign,
  subjectEntityId: string,
  policy: ReentryPolicy,
  deps: DispatchDeps,
  scope: JobScope,
): Promise<boolean> {
  try {
    const subject = await buildSubjectDocument(deps.em, subjectEntityId, scope, {}, deps.now)
    const outcome = await startCampaignForSubject(
      campaign,
      {
        subject,
        subjectEntityId,
        triggerEventId: 'marketing_automation.sweep.customers',
        triggerContext: {},
        dispatchDepth: 1,
        reentryPolicy: policy,
      },
      deps,
    )
    return outcome === 'started'
  } catch (error) {
    // One bad candidate never aborts the sweep.
    logger.error('[internal] marketing sweep candidate failed', {
      campaignId: campaign.id,
      subjectEntityId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.sweep_candidate_failed',
      attributes: { campaignId: campaign.id, subjectEntityId },
    })
    return false
  }
}

const LIVE_PERSON_FIELDS = { kind: 'person', deletedAt: null } as const

/**
 * Enrols every customer in the organization whose subject document the audience accepts.
 *
 * The cost here is projecting, not matching: a subject document is a decrypting read plus three
 * queries, so asking it of every person to find the few hundred who qualify is what makes a sweep
 * stop finishing. So the audience is first pushed down as far as the database can answer it, and
 * only the candidates it returns are projected. The pushdown is a SUPERSET by construction
 * (`lib/engine/narrowing.ts`), which is why this cannot change who gets messaged — only how much
 * work it took to find them.
 */
async function sweepCustomers(
  campaign: MarketingCampaign,
  trigger: MarketingCampaignTrigger,
  deps: DispatchDeps,
  scope: JobScope,
): Promise<number> {
  const em = deps.em
  const policy = reentryPolicyFor(trigger)
  // Parsed through the definition schema, the same way the dispatcher reads it.
  const plan = planNarrowing(readDefinition(campaign).audience)
  const candidates = await resolveCandidates(plan.narrowing, createSqlCandidateSource(em, scope, deps.now))
  logger.info('marketing sweep narrowing', {
    campaignId: campaign.id,
    narrowing: describeNarrowing(plan),
    candidates: candidates.ids ? candidates.ids.length : null,
    queries: candidates.queries,
    abandoned: candidates.abandoned,
  })

  let started = 0

  if (candidates.ids) {
    for (let offset = 0; offset < candidates.ids.length; offset += PAGE_SIZE) {
      const chunk = candidates.ids.slice(offset, offset + PAGE_SIZE)
      // A tag assignment or an order can point at a customer who has since been deleted, or at a
      // company rather than a person, so the candidate list is still filtered to live people —
      // the same predicate the unnarrowed scan applies.
      const live: { id: string }[] = await em.find(
        CustomerEntity,
        { id: { $in: chunk }, tenantId: scope.tenantId, organizationId: scope.organizationId, ...LIVE_PERSON_FIELDS },
        { fields: ['id'], orderBy: { id: 'ASC' } },
      )
      for (const candidate of live) {
        if (await startForCandidate(campaign, candidate.id, policy, deps, scope)) started += 1
      }
      em.clear()
    }
    return started
  }

  let cursor: string | null = null

  for (;;) {
    const where: FilterQuery<CustomerEntity> = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...LIVE_PERSON_FIELDS,
      ...(cursor ? { id: { $gt: cursor } } : {}),
    }
    // Ids only: the subject document does its own decrypting read per candidate, so pulling
    // whole entities here would decrypt every customer in the organization for nothing.
    // Annotated because the keyset cursor is derived from this page, which would otherwise make
    // the inferred type circular.
    const page: { id: string }[] = await em.find(
      CustomerEntity,
      where,
      { fields: ['id'], orderBy: { id: 'ASC' }, limit: PAGE_SIZE },
    )
    if (!page.length) break

    for (const candidate of page) {
      if (await startForCandidate(campaign, candidate.id, policy, deps, scope)) started += 1
    }

    if (page.length < PAGE_SIZE) break
    cursor = page[page.length - 1].id
    // Release the page before fetching the next one; every write went through its own flush.
    em.clear()
  }

  return started
}

async function sweepExpiringQuotes(
  campaign: MarketingCampaign,
  trigger: MarketingCampaignTrigger,
  deps: DispatchDeps,
  scope: JobScope,
): Promise<number> {
  const em = deps.em
  const policy = reentryPolicyFor(trigger)
  const withinDays = typeof trigger.sweepParams?.withinDays === 'number'
    ? trigger.sweepParams.withinDays
    : DEFAULT_EXPIRY_WINDOW_DAYS
  const horizon = new Date(deps.now.getTime() + withinDays * 86_400_000)

  const quotes = await em.find(
    SalesQuote,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      validUntil: { $gt: deps.now, $lte: horizon },
      // An accepted or cancelled quote has nothing left to remind anybody about. Both spellings
      // of cancelled appear in the codebase.
      status: { $nin: ['confirmed', 'canceled', 'cancelled'] },
    },
    { orderBy: { validUntil: 'ASC' }, limit: PAGE_SIZE },
  )

  let started = 0
  for (const quote of quotes) {
    if (!quote.customerEntityId) continue
    try {
      const daysUntilExpiry = quote.validUntil
        ? Math.max(0, Math.ceil((new Date(quote.validUntil).getTime() - deps.now.getTime()) / 86_400_000))
        : null
      const triggerContext = {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        quoteTotal: Number.parseFloat(String(quote.grandTotalGrossAmount ?? '0')) || 0,
        currencyCode: quote.currencyCode,
        validUntil: quote.validUntil ? new Date(quote.validUntil).toISOString() : null,
        daysUntilExpiry,
      }
      const subject = await buildSubjectDocument(em, quote.customerEntityId, scope, triggerContext, deps.now)
      const outcome = await startCampaignForSubject(
        campaign,
        {
          subject,
          subjectEntityId: quote.customerEntityId,
          triggerEventId: EXPIRING_QUOTE_TRIGGER_ID,
          triggerContext,
          dispatchDepth: 1,
          reentryPolicy: policy,
        },
        deps,
      )
      if (outcome === 'started') started += 1
    } catch (error) {
      logger.error('[internal] marketing quote sweep candidate failed', {
        campaignId: campaign.id,
        quoteId: quote.id,
        error: error instanceof Error ? error.message : String(error),
      })
      reportError(error, {
        module: 'marketing_automation',
        code: 'marketing_automation.sweep_candidate_failed',
        attributes: { campaignId: campaign.id, quoteId: quote.id },
      })
    }
  }
  return started
}

/**
 * Runs every campaign that starts on a schedule rather than an event.
 *
 * This is the path that makes re-engagement and offer-expiry reminders possible at all: nothing
 * happens to make a customer dormant, and nothing happens when a quote is about to lapse, so
 * there is no event to react to — only a periodic question to ask.
 */
export default async function handle(job: QueuedJob<SweepJob>, ctx: HandlerContext): Promise<void> {
  const scope = readScope(job.payload)
  if (!scope) return

  const deps = buildDispatchDeps(ctx, scope)
  const scheduled = await findScheduledCampaigns(deps.em, scope)
  if (!scheduled.length) return

  for (const { campaign, trigger } of scheduled) {
    try {
      // The tick is the clock; the campaign's own interval is the gate.
      if (!isSweepDue(trigger.scheduleValue, trigger.lastSweptAt, deps.now)) continue

      await deps.em.nativeUpdate(
        TriggerEntity,
        { id: trigger.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { lastSweptAt: deps.now },
      )

      const started = trigger.sweepSource === 'expiring_quotes'
        ? await sweepExpiringQuotes(campaign, trigger, deps, scope)
        : await sweepCustomers(campaign, trigger, deps, scope)
      logger.info('marketing sweep finished', {
        campaignId: campaign.id,
        source: trigger.sweepSource ?? 'customers',
        started,
      })
    } catch (error) {
      logger.error('[internal] marketing sweep failed', {
        campaignId: campaign.id,
        error: error instanceof Error ? error.message : String(error),
      })
      reportError(error, {
        module: 'marketing_automation',
        code: 'marketing_automation.sweep_failed',
        attributes: { campaignId: campaign.id },
      })
    }
  }
}
