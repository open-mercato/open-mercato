import { z } from 'zod'
import { validateCronExpression } from '@open-mercato/scheduler'

type TriggerLike = { kind?: unknown; cron?: unknown; timezone?: unknown }

/**
 * Server-side SEMANTIC schedule validation for process definitions. The shared
 * zod schemas in `data/validators.ts` gate only the cron SHAPE (they are
 * client-bundle-safe); this refinement runs every declared `{ kind: 'schedule' }`
 * trigger through the scheduler's real parser so `foo bar baz qux quux` — five
 * perfectly shaped garbage tokens — is rejected AT SAVE rather than discovered
 * at fire time. Applied at the route layer (the definitions CRUD validators'
 * server entry point), keeping cron-parser out of client bundles that import
 * the shared validators.
 */
export function withScheduleSemanticChecks<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data: unknown, ctx) => {
    const triggers = (data as { triggers?: unknown }).triggers
    if (!Array.isArray(triggers)) return
    triggers.forEach((raw, index) => {
      const trigger = raw as TriggerLike
      if (trigger?.kind !== 'schedule' || typeof trigger.cron !== 'string') return
      const timezone = typeof trigger.timezone === 'string' && trigger.timezone ? trigger.timezone : 'UTC'
      const result = validateCronExpression(trigger.cron, { timezone, count: 1 })
      if (!result.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['triggers', index, 'cron'],
          message: result.error ? `Invalid cron expression: ${result.error}` : 'Invalid cron expression',
        })
      }
    })
  })
}
