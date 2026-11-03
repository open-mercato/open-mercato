import type { EntityManager } from '@mikro-orm/postgresql'
import { reportError } from '@open-mercato/telemetry'
import { applyRuleScore, scoreRulesInPlay } from './score-rules.js'
import { logger } from './subscriber-forward.js'
import type { SubscriberContext } from './subscriber-forward.js'

/**
 * Re-scores the customer an event is about, when a change to them can change what the rules award.
 *
 * Lives in `lib/` for the reason `subscriber-forward.ts` does: everything in `subscribers/` is registered as a
 * subscriber. Runs on every customer save and every tag change in the system, so the first thing it does is ask
 * whether this scope has any rules — one probe — and only then builds a subject document.
 *
 * Rules over orders, engagement or RFM change without any of these events; the daily pass catches those.
 */
export async function rescoreSubjectFromEvent(
  eventId: string,
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId.trim() : ''
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId.trim() : ''
  // The CUSTOMER is `entityId`; a person event's `id` is the profile row.
  const subjectEntityId = typeof payload.entityId === 'string' ? payload.entityId.trim() : ''
  if (!tenantId || !organizationId || !subjectEntityId) return
  const scope = { tenantId, organizationId }

  try {
    const em = ctx.resolve<EntityManager>('em').fork()
    if (!(await scoreRulesInPlay(em, scope))) return
    await applyRuleScore(em, scope, subjectEntityId, new Date())
  } catch (error) {
    // A score that is a day late is corrected by the daily pass; a failed customer save is not corrected by anything.
    logger.error('[internal] marketing score rules failed for one customer', {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.score_rules_failed',
      attributes: { eventId },
    })
  }
}
