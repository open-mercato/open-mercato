import { z } from 'zod'

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

/**
 * Business-word deadline, anchored to task creation. A strict superset of
 * `slaDuration`: an object so the anchor and later qualifiers have somewhere to
 * live, while `slaDuration` keeps working forever as the bare-duration form.
 */
export const taskDeadlineSchema = z.object({
  duration: z.string().min(1),
})
export type TaskDeadline = z.infer<typeof taskDeadlineSchema>

/** Nudge fired `offset` before the deadline. */
export const taskReminderSchema = z.object({
  offset: z.string().min(1),
})
export type TaskReminder = z.infer<typeof taskReminderSchema>
