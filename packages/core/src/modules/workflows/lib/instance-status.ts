/**
 * Workflow instance statuses a user-task completion or a user-task SLA job must
 * not touch.
 *
 * PURE: a type-only import, so the engine does not depend on the metrics
 * module's `WORKFLOW_TERMINAL_STATUSES` for a runtime decision.
 *
 * The name means "a completion must not touch this run", NOT "its tasks are
 * closed": a FAILED run keeps its open task so a retry can pick it up.
 * `COMPENSATING` is included although it is not terminal — `compensateWorkflow`
 * holds it while rollback activities run and then overwrites it with
 * `COMPENSATED` or `FAILED`, and a completion in that window would advance a
 * run that is being rolled back.
 */

import type { WorkflowInstanceStatus } from '../data/entities'

export const RUN_STATUSES_CLOSED_TO_USER_TASKS: readonly WorkflowInstanceStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'COMPENSATING',
  'COMPENSATED',
]

export function isRunClosedToUserTasks(status: string | null | undefined): boolean {
  if (!status) return false
  return (RUN_STATUSES_CLOSED_TO_USER_TASKS as readonly string[]).includes(status)
}
