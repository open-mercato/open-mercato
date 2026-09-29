import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { findScheduledCampaigns } from '../lib/campaign-lookup.js'
import { readDefinition, startCampaignForSubject } from '../lib/dispatcher.js'
import type { DispatchDeps, ReentryPolicy } from '../lib/dispatcher.js'
import { buildSubjectDocument } from '../lib/subject-document.js'
import { describeNarrowing, planNarrowing } from '../lib/engine/narrowing.js'
import { loadTierThresholds } from '../lib/tiers.js'
import { loadSegmentDefinitions } from '../lib/segments.js'
import type { SegmentDefinition } from '../lib/segments.js'
import type { TierThreshold } from '../lib/engine/tiers.js'
import { createSqlCandidateSource, resolveCandidates } from '../lib/audience/set-resolver.js'
import { findRowSweepSource } from '../lib/sweep-sources.js'
import type { RowSweepSource, SweepCandidate } from '../lib/sweep-sources.js'
import { isSweepDue } from '../lib/sweep-interval.js'
import { pruneJobRuns, recordJobRun } from '../lib/job-runs.js'
import { pruneSegmentSnapshots, takeSegmentSnapshots } from '../lib/segment-snapshots.js'
import { loadValueBoundaries, refreshValueBoundaries } from '../lib/value-boundaries.js'
import { loadValueHorizonYears } from '../lib/value-horizon.js'
import type { ValueBoundaries } from '../lib/engine/rfm.js'
import { scanPriceWatches } from '../lib/product-watches.js'
import { sendWeeklyLeadDigests, DIGEST_JOB_KIND } from '../lib/lead-digest.js'
import { announceBreaker, applyDeliverabilityGuardrails } from '../lib/deliverability.js'
import { announceAppliedWinner, applyEarnedWinners } from '../lib/auto-winner.js'
import { emitMarketingAutomationEvent } from '../events.js'
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

/**
 * How many ROWS one tick of a row source will walk, across as many pages as that takes.
 *
 * A row source used to be asked for a single page and nothing more, so an installation with more than
 * `PAGE_SIZE` matching rows kept re-reading the same page: the rows past it never fired at all, and for a
 * claimed source — "ask for a review of this order exactly once" — the claimed rows at the front of the
 * order occupied the whole page forever, so the sweep did nothing while looking busy.
 *
 * Bounded rather than unbounded because a tick has to end. The ceiling being hit is logged, since it means
 * the remainder waits for the next tick and somebody may want to know.
 */
const MAX_ROWS_PER_TICK = 5_000

/**
 * The per-lane sample an automatic promotion waits for, before the auto-apply multiplier.
 *
 * The same default the results screen suggests at, so the two answers cannot drift into disagreeing about
 * whether a test is ready — the automatic path then doubles it, because acting unattended needs more than
 * suggesting does.
 */
const DEFAULT_MINIMUM_REACHED = 50

/** What the subject projection needs that is tenant-wide rather than per-customer. */
type ProjectionOptions = {
  tierThresholds: TierThreshold[]
  segments: SegmentDefinition[]
  valueBoundaries: ValueBoundaries
  valueHorizonYears: number
}

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
  projection: ProjectionOptions,
): Promise<boolean> {
  try {
  const subject = await buildSubjectDocument(deps.em, subjectEntityId, scope, {}, deps.now, projection)
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
projection: ProjectionOptions,
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
      if (await startForCandidate(campaign, candidate.id, policy, deps, scope, projection)) started += 1
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
    if (await startForCandidate(campaign, candidate.id, policy, deps, scope, projection)) started += 1
  }

  if (page.length < PAGE_SIZE) break
  cursor = page[page.length - 1].id
  // Release the page before fetching the next one; every write went through its own flush.
  em.clear()
}

return started
}

/**
 * Runs a ROW source: one candidate per row its query returned.
 *
 * Every row source shares this, so adding one is a query and a label — see `lib/sweep-sources.ts`.
 * A candidate may carry a durable claim, which is what makes "ask for a review of this order exactly
 * once, ever" enforceable by the database rather than by a marker column of its own.
 */
async function sweepRows(
campaign: MarketingCampaign,
trigger: MarketingCampaignTrigger,
source: RowSweepSource,
deps: DispatchDeps,
scope: JobScope,
projection: ProjectionOptions,
): Promise<number> {
const policy = reentryPolicyFor(trigger)
const params = (trigger.sweepParams ?? {}) as { withinDays?: number }

let started = 0
let walked = 0

/**
 * Paged, because the claimed rows sit at the FRONT.
 *
 * A claim makes a row single-use, but it does not remove the row from the source's query — an order stays
 * fulfilled forever. Reading one page therefore meant re-reading rows that had already been acted on,
 * while the rows behind them were never reached. Offset paging is safe here in a way it is not for the
 * population scan above: each source orders totally, and a row arriving or leaving mid-sweep costs at
 * worst one row seen twice or once late, which the claim already makes harmless.
 */
for (let offset = 0; offset < MAX_ROWS_PER_TICK; offset += PAGE_SIZE) {
  const page = await source.collect(deps.em, scope, params, deps.now, PAGE_SIZE, offset)
  walked += page.length
  for (const candidate of page) {
    if (await startRowCandidate(campaign, source, candidate, policy, deps, scope, projection)) started += 1
  }
  if (page.length < PAGE_SIZE) break
  if (offset + PAGE_SIZE >= MAX_ROWS_PER_TICK) {
    logger.warn('marketing sweep reached its per-tick row ceiling', {
      campaignId: campaign.id,
      source: source.id,
      walked,
      ceiling: MAX_ROWS_PER_TICK,
    })
  }
}

return started
}

/**
 * One row, and the promise that a bad one never aborts the sweep.
 */
async function startRowCandidate(
  campaign: MarketingCampaign,
  source: RowSweepSource,
  candidate: SweepCandidate,
  policy: ReentryPolicy,
  deps: DispatchDeps,
  scope: JobScope,
  projection: ProjectionOptions,
): Promise<boolean> {
  try {
    const subject = await buildSubjectDocument(
      deps.em,
      candidate.subjectEntityId,
      scope,
      candidate.trigger,
      deps.now,
      projection,
    )
    const outcome = await startCampaignForSubject(
      campaign,
      {
        subject,
        subjectEntityId: candidate.subjectEntityId,
        triggerEventId: source.triggerEventId,
        triggerContext: candidate.trigger,
        dispatchDepth: 1,
        reentryPolicy: policy,
        occurrenceKey: candidate.claimKey ?? null,
      },
      deps,
    )
    return outcome === 'started'
  } catch (error) {
    // One bad row never aborts the sweep.
    logger.error('[internal] marketing sweep row failed', {
      campaignId: campaign.id,
      source: source.id,
      subjectEntityId: candidate.subjectEntityId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.sweep_candidate_failed',
      attributes: { campaignId: campaign.id, source: source.id },
    })
    return false
  }
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
  // NOT an early return: the housekeeping below — segment sizes, job-log pruning — has nothing to do with
  // whether any campaign runs on a schedule, and returning here left both undone on every installation that
  // only uses event triggers.

  // Once per job rather than once per candidate: the ladder is tenant configuration, not per-subject.
  /**
   * The tenant ladder and the segment definitions, loaded ONCE for the whole job — and only when there is a
   * campaign to project candidates for.
   *
   * Both are tenant configuration rather than per-subject facts, and a sweep may project thousands of
   * candidates, so `buildSubjectDocument` must not read them once per customer.
   */
  const projection: ProjectionOptions | null = scheduled.length
    ? {
        tierThresholds: await loadTierThresholds(deps.container, scope),
        segments: await loadSegmentDefinitions(deps.em, scope),
        // Refreshed below once a day; read here as one row, because a percentile over every buyer must not
        // run per candidate.
        valueBoundaries: await loadValueBoundaries(deps.em, scope),
        valueHorizonYears: await loadValueHorizonYears(deps.container, scope),
      }
    : null

  for (const { campaign, trigger } of scheduled) {
    try {
      // The tick is the clock; the campaign's own interval is the gate.
      if (!isSweepDue(trigger.scheduleValue, trigger.lastSweptAt, deps.now)) continue

      /**
       * Advanced BEFORE the work, deliberately.
       *
       * This makes a sweep at-most-once per interval rather than at-least-once, and for work that sends
       * email that is the right way round: a sweep that failed halfway has already enrolled people, and
       * re-running it on the next tick would enrol them again wherever the campaign's re-entry policy
       * allows it. The failure is not lost by this — the job-run row below records `failed` with the
       * message, and the handler at the bottom reports it — it is deferred to the next interval, which is
       * the cheaper of the two mistakes.
       */
      await deps.em.nativeUpdate(
        TriggerEntity,
        { id: trigger.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { lastSweptAt: deps.now },
      )

      const rowSource = findRowSweepSource(trigger.sweepSource)
      /**
       * Logged as a job run, per campaign.
       *
       * A sweep that quietly stopped firing is indistinguishable from a sweep with nothing to do, which is
       * the failure this module could not previously answer for. One row per campaign rather than per tick,
       * because "did the win-back campaign run last night" is the question people actually ask.
       */
      const { counters } = await recordJobRun(
        deps.em,
        scope,
        { kind: 'sweep', campaignId: campaign.id },
        async () => {
          const started = rowSource
            ? await sweepRows(campaign, trigger, rowSource, deps, scope, projection as ProjectionOptions)
            : await sweepCustomers(campaign, trigger, deps, scope, projection as ProjectionOptions)
          return { counters: { started } }
        },
      )
      logger.info('marketing sweep finished', {
        campaignId: campaign.id,
        source: trigger.sweepSource ?? 'customers',
        started: counters?.started ?? 0,
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

  /**
   * The deliverability guardrail, before anything else on this pass.
   *
   * First because everything below is about sending more: a campaign being refused by the transport should stop
   * before the sweep enrols another thousand people into it.
   */
  try {
    const tripped = await applyDeliverabilityGuardrails(deps.em, deps.container, scope, deps.now)
    for (const outcome of tripped) {
      logger.warn('marketing campaign paused by the deliverability guardrail', {
        campaignId: outcome.campaignId,
        failureRate: outcome.decision.failureRate,
        attempts: outcome.decision.attempts,
      })
      await announceBreaker(deps.container, scope, outcome)
    }
  } catch (error) {
    logger.warn('[internal] marketing deliverability guardrail failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  /**
   * The weekly lead digest, which decides for itself whether it is due.
   *
   * Recorded as a job run so the operator can see it happened — and so the record IS the "already sent this
   * week" answer, rather than a second flag that can disagree with it.
   */
  try {
    const due = await sendWeeklyLeadDigests(deps.em, deps.container, scope, deps.now)
    if (due.dueNow) {
      await recordJobRun(deps.em, scope, { kind: DIGEST_JOB_KIND }, async () => ({
        counters: { sent: due.sent, skipped: due.skipped },
      }))
      if (due.sent > 0) logger.info('marketing lead digests sent', { sent: due.sent })
    }
  } catch (error) {
    logger.warn('[internal] marketing lead digest failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  /**
   * Price watches, on the same periodic pass.
   *
   * One pass rather than a queue of its own, for the reason the snapshots share it: a module with three
   * schedules has three things that can be unscheduled. The scan commits its bookkeeping BEFORE the events go
   * out, so a crash between the two sends nothing rather than sending twice.
   */
  try {
    const watches = await scanPriceWatches(deps.em, scope, deps.now)
    for (const firing of watches.fired) {
      await emitMarketingAutomationEvent('marketing_automation.product.price_dropped', {
        entityId: firing.watch.subjectEntityId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        sku: firing.watch.sku,
        currencyCode: firing.watch.currencyCode,
        previousPrice: String(firing.decision.previous),
        currentPrice: String(firing.decision.current),
        dropPercent: String(firing.decision.dropPercent),
      }, { persistent: true })
    }
    if (watches.fired.length > 0) {
      logger.info('marketing price drops announced', { count: watches.fired.length, scanned: watches.scanned })
    }
  } catch (error) {
    logger.warn('[internal] marketing price watch scan failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  /**
   * Today's segment sizes, on the same pass.
   *
   * Idempotent through a unique index on the day, so running on every tick records one point per day without
   * needing to remember whether it already did.
   */
  /**
   * A/B tests that have earned a conclusion, concluded.
   *
   * OFF unless a tenant switched it on — promoting a winner rewrites an author's campaign, which this module
   * otherwise reserves for a person. When it does act it goes through the ordinary command, so the change is
   * validated, version-checked and recorded as a revision like any edit.
   */
  try {
    const applied = await applyEarnedWinners(deps.em, deps.container, scope, DEFAULT_MINIMUM_REACHED)
    for (const winner of applied) {
      logger.info('marketing split winner applied automatically', {
        campaignId: winner.campaignId,
        variant: winner.variant,
        reached: winner.reached,
      })
      await announceAppliedWinner(deps.container, scope, winner)
    }
  } catch (error) {
    logger.warn('[internal] marketing automatic winner selection failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  /**
   * The RFM cut points, refreshed on the same daily pass as the segment sizes.
   *
   * Here rather than in the per-campaign loop because they describe the SHOP, not a campaign, and one
   * percentile sweep over the buyers serves every campaign that runs afterwards. A failure is logged and the
   * pass continues: the previous day's boundaries are a perfectly good answer, and no boundaries at all simply
   * means no scores — never a wrong score.
   */
  try {
    const boundaries = await refreshValueBoundaries(deps.em, scope, deps.now)
    logger.info('marketing value boundaries refreshed', { buyers: boundaries.buyerCount })
  } catch (error) {
    logger.warn('[internal] marketing value boundaries refresh failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const snapshots = await takeSegmentSnapshots(deps.em, deps.container, scope, deps.now)
    if (snapshots.taken > 0) logger.info('marketing segment sizes recorded', { taken: snapshots.taken })
    await pruneSegmentSnapshots(deps.em, scope, deps.now)
  } catch (error) {
    logger.warn('[internal] marketing segment snapshots failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Pruned here rather than by a job of its own: a cleanup task nobody scheduled is a table that grows
  // until somebody notices it.
  try {
    await pruneJobRuns(deps.em, scope, deps.now)
  } catch (error) {
    logger.warn('[internal] marketing job-run pruning failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
