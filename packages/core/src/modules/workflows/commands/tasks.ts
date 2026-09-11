/**
 * `workflows.tasks.complete` — the command behind a notification quick action.
 *
 * The notifications module executes a `commandId` action through the command
 * bus after claiming the row with a conditional UPDATE, so a double-click or a
 * retried request is a 409 rather than a second completion
 * (`notificationService.executeAction`). That claim is the outer idempotency
 * guard; `completeUserTask`'s own `status IN (PENDING, IN_PROGRESS)` lookup is
 * the inner one.
 *
 * The command input is `{ id: <userTaskId> }` — the notification's
 * `sourceEntityId`. It carries no decision, which is precisely why
 * `lib/task-quick-action.ts` only offers this button for a task with at most
 * one decision: the sole decision is re-resolved here from the instance's
 * pinned definition, so a quick action selects exactly the route the full task
 * page would have.
 *
 * Nothing about this path is more permissive than the HTTP route: the caller
 * must hold `workflows.tasks.complete`, and only the notification's own
 * recipient can execute an action on it.
 */

import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { UserTask } from '../data/entities'
import { loadTaskDecisionContext } from '../lib/task-decision-context'
import type { TaskHandlerService } from '../lib/task-handler'

export const WORKFLOWS_TASK_COMPLETE_COMMAND_ID = 'workflows.tasks.complete'

const COMPLETE_TASK_FEATURE = 'workflows.tasks.complete'

/**
 * Non-strict on purpose: the notifications module spreads the action payload
 * into the command input, so unrelated keys must be ignored rather than reject
 * the whole call.
 */
const completeTaskCommandSchema = z.object({
  id: z.string().uuid(),
  comments: z.string().optional(),
})

export type CompleteTaskCommandInput = z.infer<typeof completeTaskCommandSchema>

type RbacServiceLike = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null }
  ) => Promise<boolean>
}

/**
 * Fail-closed: no caller identity, no rbacService, or a thrown check all deny.
 * A command reachable from a notification must never be a softer gate than the
 * route that does the same thing.
 */
async function callerMayCompleteTasks(
  ctx: CommandRuntimeContext,
  scope: { tenantId: string; organizationId: string }
): Promise<boolean> {
  const userId = ctx.auth?.sub
  if (!userId) return false
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.userHasAllFeatures) return false
    return await rbac.userHasAllFeatures(userId, [COMPLETE_TASK_FEATURE], {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  } catch {
    return false
  }
}

const completeUserTaskCommand: CommandHandler<
  CompleteTaskCommandInput,
  { taskId: string; decisionId: string | null }
> = {
  id: WORKFLOWS_TASK_COMPLETE_COMMAND_ID,
  async execute(rawInput, ctx) {
    const parsed = completeTaskCommandSchema.parse(rawInput)

    const userId = ctx.auth?.sub
    const tenantId = ctx.auth?.tenantId ?? null
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null

    if (!userId || !tenantId || !organizationId) {
      throw new Error('[internal] workflows.tasks.complete requires an authenticated caller scope')
    }

    const scope = { tenantId, organizationId }
    if (!(await callerMayCompleteTasks(ctx, scope))) {
      throw new Error('[internal] Caller is not allowed to complete workflow tasks')
    }

    const container = ctx.container as AwilixContainer
    const em = (container.resolve('em') as EntityManager).fork()

    const task = await em.findOne(UserTask, {
      id: parsed.id,
      tenantId,
      organizationId,
      status: { $in: ['PENDING', 'IN_PROGRESS'] },
    })
    if (!task) {
      throw new Error('[internal] Task not found or already completed')
    }

    // Re-resolved from the pinned definition, exactly as the task page does.
    // More than one decision means the quick action should never have been
    // offered (see `lib/task-quick-action.ts`), so refuse rather than pick one.
    const { decisions } = await loadTaskDecisionContext(em, task)
    if (decisions.length > 1) {
      throw new Error('[internal] Task offers multiple decisions and cannot be completed in one click')
    }
    const decisionId = decisions[0]?.id ?? null

    const taskHandler = container.resolve('taskHandler') as TaskHandlerService
    await taskHandler.completeUserTask(em, container, {
      taskId: task.id,
      formData: {},
      userId,
      comments: parsed.comments,
      ...(decisionId ? { decisionId } : {}),
      scope,
    })

    return { taskId: task.id, decisionId }
  },
  buildLog({ input, result }) {
    return {
      resourceKind: 'workflows.user_task',
      resourceId: result?.taskId ?? input.id,
      actionLabel: 'workflows.tasks.complete',
      payload: { decisionId: result?.decisionId ?? null },
    }
  },
}

registerCommand(completeUserTaskCommand)

export default completeUserTaskCommand
