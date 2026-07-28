/**
 * Persistent subscriber for `workflows.task.assigned`.
 *
 * Writes a `CustomerTodoLink` with `todoSource: 'workflows'` for every customer
 * record a freshly created workflow task is bound to, so the task shows up on
 * that customer's Tasks section (spec §2.3 phase-in).
 *
 * Logic lives in `../lib/link-workflow-task-handler.ts`, mirroring the
 * link-channel-message subscribers.
 */
import linkWorkflowTaskHandler from '../lib/link-workflow-task-handler'

export const metadata = {
  event: 'workflows.task.assigned',
  persistent: true,
  id: 'customers:link-workflow-task',
}

export default linkWorkflowTaskHandler
