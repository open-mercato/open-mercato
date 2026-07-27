import { z } from 'zod'
import { validateCronExpression } from '@open-mercato/scheduler'

/**
 * Server-side SEMANTIC schedule validation for task definitions. The shared
 * zod schemas in `data/validators.ts` gate only the cron SHAPE (they are
 * client-bundle-safe); this refinement runs the expression through the
 * scheduler's real parser so `foo bar baz qux quux` — five perfectly shaped
 * garbage tokens — is rejected before a task is saved with a schedule that
 * would never fire. Applied at the route layer (the tasks CRUD validators'
 * server entry point), keeping cron-parser out of client bundles that import
 * the shared validators.
 */
export function withScheduleSemanticChecks<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data: unknown, ctx) => {
    const input = data as { scheduleCron?: string | null; scheduleTimezone?: string | null }
    if (!input.scheduleCron) return
    const result = validateCronExpression(input.scheduleCron, {
      timezone: input.scheduleTimezone ?? 'UTC',
      count: 1,
    })
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduleCron'],
        message: result.error ? `Invalid cron expression: ${result.error}` : 'Invalid cron expression',
      })
    }
  })
}
