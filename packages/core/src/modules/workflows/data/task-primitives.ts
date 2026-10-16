import { z } from 'zod'
import { parseAbsoluteDeadline } from '../lib/duration'

/**
 * The smallest pieces of the §6.1 task vocabulary — priority, deadline and
 * reminders.
 *
 * They live apart from `validators.ts` because the Invoke Agent node's Review
 * section (§7.5) authors the SAME three things for the implicit disposition
 * task, and its config schema lives in `activity-config-schemas.ts`, which
 * `validators.ts` imports. Re-declaring the shapes there would give the two
 * surfaces two spellings of one vocabulary; importing `validators.ts` from
 * there would close the registry-bootstrap loop that file exists to avoid.
 *
 * `validators.ts` re-exports every symbol here, so the public import surface is
 * unchanged.
 */

/** Mirrors the platform's priority labels (root AGENTS.md → PR Workflow). */
export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'extreme'])
export type TaskPriority = z.infer<typeof taskPrioritySchema>

export const TASK_DEADLINE_AT_ERROR =
  'Deadline "at" must be an ISO date (YYYY-MM-DD) or an ISO datetime with a timezone offset or Z'

/**
 * Business-word deadline, anchored to task creation. A strict superset of
 * `slaDuration`: an object so the anchor and later qualifiers have somewhere to
 * live, while `slaDuration` keeps working forever as the bare-duration form.
 *
 * This is the duration-only contract and it stays exactly that: consumers read
 * `deadline.duration` as a `string`. A USER_TASK deadline that may also be an
 * absolute `at` is the additive `TaskDeadlineSpec` below.
 */
export const taskDeadlineSchema = z.object({
  duration: z.string().min(1),
})
export type TaskDeadline = z.infer<typeof taskDeadlineSchema>

/**
 * A USER_TASK deadline (`userTaskConfig.deadline`): either a `TaskDeadline`
 * duration or an absolute `at`. Exactly one form per deadline:
 * - `duration` — anchored to task creation (e.g. `P3D`);
 * - `at` — an ABSOLUTE ISO date or datetime, usually interpolated from the run
 *   context (`{{context.dueDate}}`), for deadlines computed elsewhere. Resolved
 *   once, at task creation, by `resolveTaskDeadline` (`lib/task-resolution.ts`).
 *   A literal is validated here; a template is validated once it resolves.
 *
 * Every value `taskDeadlineSchema` accepts, this accepts too.
 */
export const taskDeadlineSpecSchema = z
  .object({
    duration: z.string().min(1).optional(),
    at: z.string().min(1).optional(),
  })
  .superRefine((deadline, ctx) => {
    const hasDuration = deadline.duration !== undefined
    const hasAt = deadline.at !== undefined
    if (hasDuration && hasAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['at'],
        message: 'A deadline is either a duration or an absolute "at", not both',
      })
    } else if (!hasDuration && !hasAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['duration'],
        message: 'A deadline needs a duration or an absolute "at"',
      })
    } else if (deadline.at !== undefined && !deadline.at.includes('{{') && !parseAbsoluteDeadline(deadline.at)) {
      ctx.addIssue({
        code: 'custom',
        path: ['at'],
        message: TASK_DEADLINE_AT_ERROR,
      })
    }
  })
export type TaskDeadlineSpec = z.infer<typeof taskDeadlineSpecSchema>

/** Nudge fired `offset` before the deadline. */
export const taskReminderSchema = z.object({
  offset: z.string().min(1),
})
export type TaskReminder = z.infer<typeof taskReminderSchema>
