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

/**
 * The deadline diagnostics, as an i18n key plus the English fallback. The zod
 * issue carries the fallback as its `message` and the key as
 * `params.i18nKey`, so every display/response boundary can localize it
 * (`resolveIssueMessage`, `lib/definition-error-body.ts`) while a caller with no
 * dictionary still reads English.
 */
export const TASK_DEADLINE_MESSAGES = {
  bothForms: {
    key: 'workflows.validation.taskDeadline.bothForms',
    fallback: 'A user task deadline is either "deadline" (a duration) or "deadlineAt" (an absolute date), not both',
  },
  invalidAt: {
    key: 'workflows.validation.taskDeadline.invalidAt',
    fallback: '"deadlineAt" must be an ISO date (YYYY-MM-DD) or an ISO datetime with a timezone offset or Z',
  },
  invalidResolvedAt: {
    key: 'workflows.validation.taskDeadline.invalidResolvedAt',
    fallback:
      'Invalid user task "deadlineAt": "{authored}" resolved to "{resolved}", which is not an ISO date (YYYY-MM-DD) or an ISO datetime with a timezone offset or Z',
  },
} as const

/**
 * Business-word deadline, anchored to task creation. A strict superset of
 * `slaDuration`: an object so the anchor and later qualifiers have somewhere to
 * live, while `slaDuration` keeps working forever as the bare-duration form.
 *
 * Duration-only, and it stays exactly that: consumers read `deadline.duration`
 * as a `string`, and every stored or served `deadline` carries one. An absolute
 * deadline is the sibling `userTaskConfig.deadlineAt` (`taskDeadlineAtSchema`).
 */
export const taskDeadlineSchema = z.object({
  duration: z.string().min(1),
})
export type TaskDeadline = z.infer<typeof taskDeadlineSchema>

/**
 * An ABSOLUTE user-task deadline (`userTaskConfig.deadlineAt`, #7181): an ISO
 * date or datetime, usually interpolated from the run context
 * (`{{context.dueDate}}`), for deadlines computed elsewhere. Resolved once, at
 * task creation, by `resolveTaskDeadline` (`lib/task-resolution.ts`).
 *
 * A literal is validated here; a template is validated once it resolves. It is
 * a sibling of `deadline`, never a form of it, so a reader of the duration-only
 * `deadline` contract never meets it; the two are mutually exclusive on a step.
 */
export const taskDeadlineAtSchema = z.string().superRefine((value, ctx) => {
  if (value.includes('{{') || parseAbsoluteDeadline(value)) return
  ctx.addIssue({
    code: 'custom',
    message: TASK_DEADLINE_MESSAGES.invalidAt.fallback,
    params: { i18nKey: TASK_DEADLINE_MESSAGES.invalidAt.key },
  })
})

/** Nudge fired `offset` before the deadline. */
export const taskReminderSchema = z.object({
  offset: z.string().min(1),
})
export type TaskReminder = z.infer<typeof taskReminderSchema>
