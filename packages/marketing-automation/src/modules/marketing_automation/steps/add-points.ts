import { z } from 'zod'
import { emitMarketingAutomationEvent } from '../events.js'
import { addScoreEntry } from '../lib/scores.js'
import type { StepHandler } from '../lib/engine/registry.js'
import type { AutomationContext } from '../lib/engine/types.js'
import type { StepDeps } from './deps.js'

const paramsSchema = z.object({
  /** Signed, so one campaign can award and another deduct. Zero would be a no-op worth refusing. */
  points: z.number().int().refine((value) => value !== 0, { message: 'points must not be zero' }),
  reason: z.string().max(200).optional(),
})

export const addPointsStep: StepHandler<StepDeps> = {
  type: 'add_points',
  labelKey: 'marketing_automation.step.add_points.label',
  descriptionKey: 'marketing_automation.step.add_points.description',
  icon: 'trending-up',
  paramsSchema,
  uiFields: [
    { name: 'points', kind: 'number', labelKey: 'marketing_automation.step.add_points.param.points', required: true },
    { name: 'reason', kind: 'text', labelKey: 'marketing_automation.step.add_points.param.reason' },
  ],
  async execute(ctx: AutomationContext, rawParams, deps: StepDeps) {
    const params = paramsSchema.parse(rawParams)
    if (!ctx.subjectEntityId) {
      return { status: 'skipped', detail: 'no subject to score' }
    }

    const result = await addScoreEntry(deps.em, {
      scope: deps.scope,
      subjectEntityId: ctx.subjectEntityId,
      points: params.points,
      reason: params.reason ?? null,
      source: 'campaign',
      campaignId: ctx.campaignId ?? null,
      // The pair that makes this idempotent: a redelivered job collides instead of scoring twice.
      runId: ctx.runId ?? null,
      stepId: ctx.actionId ?? null,
      now: deps.now,
    })

    if (!result.applied) {
      return { status: 'done', detail: 'points already awarded for this step' }
    }

    // Carries the PREVIOUS total as well as the new one, which is what lets an audience express
    // "reached 100 points" (`trigger.previousPoints < 100 AND score.points >= 100`) instead of
    // "is above 100 points" — the difference between firing once and firing on every later change.
    await emitMarketingAutomationEvent('marketing_automation.score.changed', {
      entityId: ctx.subjectEntityId,
      tenantId: deps.scope.tenantId,
      organizationId: deps.scope.organizationId,
      points: result.points,
      previousPoints: result.previousPoints,
      delta: params.points,
      campaignId: ctx.campaignId ?? null,
    }, { persistent: true })

    return { status: 'done', detail: `${params.points > 0 ? '+' : ''}${params.points} points (${result.points} total)` }
  },
}
