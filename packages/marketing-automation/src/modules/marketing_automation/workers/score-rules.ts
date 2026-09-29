import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { reportError } from '@open-mercato/telemetry'
import { recordJobRun } from '../lib/job-runs.js'
import type { ScoreRulesJob } from '../lib/queue.js'
import { SCORE_RULES_JOB_KIND, applyRuleScore, loadScoreRules } from '../lib/score-rules.js'
import type { ApplyRuleScoreOptions } from '../lib/score-rules.js'
import { loadValueBoundaries } from '../lib/value-boundaries.js'
import { loadValueHorizonYears } from '../lib/value-horizon.js'
import { logger, readScope } from './shared.js'
import type { HandlerContext, JobScope } from './shared.js'

// See the note in dispatch.ts: this string must stay a literal.
export const metadata: WorkerMeta = {
  queue: 'marketing-automation-score-rules',
  id: 'marketing_automation:score-rules',
  concurrency: 1,
}

const PAGE_SIZE = 200

type Counters = { checked: number; changed: number; failed: number }

/**
 * Brings every customer's rule points up to date in one scope.
 *
 * Queued when a rule is created, edited or removed, and once a day by the sweep, because a rule over orders or
 * engagement changes its answer without anything happening to the customer record.
 *
 * With rules defined it walks every live person. With none it walks only the people who still HAVE rule points —
 * removing the last rule has to take its points back, and that must not cost a scan of the whole population.
 */
export default async function handle(job: QueuedJob<ScoreRulesJob>, ctx: HandlerContext): Promise<void> {
  const scope = readScope(job.payload)
  if (!scope) return

  const em = ctx.resolve<EntityManager>('em').fork()
  const container = (ctx.container ?? { resolve: ctx.resolve }) as unknown as AwilixContainer

  await recordJobRun(em, scope, { kind: SCORE_RULES_JOB_KIND }, async () => {
    const rules = await loadScoreRules(em, scope)
    const options: ApplyRuleScoreOptions = {
      rules,
      // Tenant configuration, read once for the pass rather than once per customer.
      valueBoundaries: await loadValueBoundaries(em, scope),
      valueHorizonYears: await loadValueHorizonYears(container, scope),
    }
    const counters: Counters = { checked: 0, changed: 0, failed: 0 }
    const now = new Date()

    let cursor: string | null = null
    for (;;) {
      const page: string[] = rules.length > 0
        ? await livePersonPage(em, scope, cursor)
        : await scoredPersonPage(em, scope, cursor)
      if (page.length === 0) break

      for (const subjectEntityId of page) {
        counters.checked += 1
        try {
          const outcome = await applyRuleScore(em, scope, subjectEntityId, now, options)
          if (outcome.applied) counters.changed += 1
        } catch (error) {
          // One customer's failure never stops the pass; the counters say how many, the log says why.
          counters.failed += 1
          logger.warn('[internal] marketing score rules failed for one subject', {
            subjectEntityId,
            error: error instanceof Error ? error.message : String(error),
          })
          reportError(error, { module: 'marketing_automation', code: 'marketing_automation.score_rules_failed' })
        }
      }

      if (page.length < PAGE_SIZE) break
      cursor = page[page.length - 1]
      em.clear()
    }

    if (counters.changed > 0) logger.info('marketing score rules applied', counters)
    return { counters }
  })
}

async function livePersonPage(em: EntityManager, scope: JobScope, cursor: string | null): Promise<string[]> {
  const rows: { id: string }[] = await em.find(
    CustomerEntity,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind: 'person',
      deletedAt: null,
      ...(cursor ? { id: { $gt: cursor } } : {}),
    },
    { fields: ['id'], orderBy: { id: 'ASC' }, limit: PAGE_SIZE },
  )
  return rows.map((row) => row.id)
}

/** Live people whose rule points are not zero: the only ones a pass with no rules can change. */
async function scoredPersonPage(em: EntityManager, scope: JobScope, cursor: string | null): Promise<string[]> {
  const rows = await em.getConnection().execute<Array<{ id: string }>>(
    `select e.subject_entity_id as id
       from marketing_customer_score_entries e
       join customer_entities c
         on c.id = e.subject_entity_id and c.kind = 'person' and c.deleted_at is null
        and c.tenant_id = e.tenant_id and c.organization_id = e.organization_id
      where e.tenant_id = ? and e.organization_id = ? and e.rule_sequence is not null
        ${cursor ? 'and e.subject_entity_id > ?' : ''}
      group by e.subject_entity_id
     having sum(e.points) <> 0
      order by e.subject_entity_id
      limit ${PAGE_SIZE}`,
    cursor ? [scope.tenantId, scope.organizationId, cursor] : [scope.tenantId, scope.organizationId],
  )
  return rows.map((row) => row.id)
}
