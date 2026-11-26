import { reportError } from '@open-mercato/telemetry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { MarketingScoreRule } from '../../data/entities.js'
import { enqueueScoreRulesRecompute } from '../../lib/queue.js'

const logger = createLogger('marketing_automation')

export function presentScoreRule(rule: MarketingScoreRule) {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? null,
    expression: rule.expression ?? null,
    points: rule.points,
    isEnabled: rule.isEnabled,
    updatedAt: rule.updatedAt.toISOString(),
  }
}

/**
 * Queues the pass that applies a rule change to everybody.
 *
 * A failure to queue does not fail the save: the rule is stored, and the daily pass applies it by tomorrow at the
 * latest. The operator can also recalculate one customer from their profile.
 */
export async function queueRecompute(scope: { tenantId: string; organizationId: string }): Promise<void> {
  try {
    await enqueueScoreRulesRecompute(scope)
  } catch (error) {
    logger.warn('[internal] marketing score rules pass could not be queued after a rule change', {
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, { module: 'marketing_automation', code: 'marketing_automation.score_rules_enqueue_failed' })
  }
}

export const forbiddenExpressionResponseBody = {
  error: 'A score rule cannot read the score or segment membership',
  code: 'marketing_automation.errors.scoreRuleSelfReference',
}
