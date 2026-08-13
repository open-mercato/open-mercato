/**
 * `sales_call_planner.ensure_task` — the idempotent way a workflow transition
 * turns an extracted task list into CRM rows.
 *
 * ## Why this command exists at all
 *
 * `packages/core/src/modules/customers/workflows.ts` is a written policy against
 * declaring a CREATE command workflow-safe: `UPDATE_ENTITY` carries no
 * idempotency key, activities retry (default 3 attempts) and an event trigger
 * can fire the same workflow repeatedly, so *"CREATE does not converge: a retry
 * after a partial failure, or a trigger storm, turns one business event into N
 * records that nobody asked for"*. That objection is correct and this command
 * does not route around it — it ANSWERS it. Every row it writes is addressed by
 * an id derived from `(workflowInstanceId, stepId, index)`, so a second run of
 * the same activity with the same input rewrites the same rows. The command
 * converges, which is the property the policy actually demands.
 *
 * ## The crux: what the inner command does with a duplicate id
 *
 * `customers.interactions.create` accepts a caller-supplied `id`
 * (`interactionCreateSchema`, `id: z.string().uuid().optional()`) and passes it
 * straight to `em.create(...)` + `persist` + `flush`. It does NOT upsert and it
 * does NOT check for an existing row: a second create with the same id hits the
 * primary key and THROWS. So idempotency cannot be delegated to it. This command
 * therefore reads the id first and dispatches create-or-update itself, and
 * additionally treats a duplicate-key failure from a create as proof that a
 * concurrent invocation won the race — it re-reads and updates instead. Both
 * paths still go through the command bus, so audit, undo, cache invalidation and
 * query-index maintenance apply to every write.
 *
 * ## Scope
 *
 * Never from the input. `executeUpdateEntity` hands the definition's `input`
 * object to the command verbatim and supplies scope separately, from the
 * workflow INSTANCE, as `ctx.auth` (with `isSuperAdmin: false`). An authored —
 * and AI-draftable — definition naming a `tenantId` would otherwise be naming
 * another tenant's data. `ensureTaskInputSchema` declares no scope fields and
 * zod strips the unknown keys, so a smuggled `tenantId` cannot reach the inner
 * command even if a definition carries one.
 */

import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerInteraction } from '@open-mercato/core/modules/customers/data/entities'
import { requireTimelineParentEntity } from '@open-mercato/core/modules/customers/commands/shared'
import { ensureTaskInputSchema, type EnsureTaskInput, type TaskAction } from '../data/validators'
import { deriveEnsureTaskId, toInteractionPriority } from './shared'

/**
 * Stamped on every row so the CRM can tell a briefing-call task from one a
 * human scheduled, and so a later cleanup can find the whole cohort. A machine
 * token, never displayed verbatim.
 */
export const ENSURE_TASK_SOURCE = 'sales_call_planner.deal_brief'

const INTERACTION_TYPE_TASK = 'task'

const CREATE_COMMAND_ID = 'customers.interactions.create'
const UPDATE_COMMAND_ID = 'customers.interactions.update'

type EnsureTaskDisposition = 'created' | 'updated' | 'skipped'

/**
 * The transition's output persists into `instance.context` namespaced by the
 * activity name, so this is a public surface: B4's notification reads `ensured`,
 * and an operator triaging a run reads the id lists. Declared as `outputSchema`
 * so the workflows context ledger can type `<activity>.result.*` in the Studio's
 * variable picker instead of rendering it `unknown`.
 */
export const ensureTaskOutputSchema = z.object({
  entityId: z.string().uuid(),
  /** Every deterministic id, in input order — the batch's stable identity. */
  taskIds: z.array(z.string().uuid()),
  /** Rows that did not exist before this invocation. */
  createdIds: z.array(z.string().uuid()),
  /** Rows that existed and were rewritten to match the current input. */
  updatedIds: z.array(z.string().uuid()),
  /**
   * Rows a human had already deleted. Left alone: a workflow retry must not
   * resurrect a task somebody deliberately removed.
   */
  skippedIds: z.array(z.string().uuid()),
  /** `createdIds.length + updatedIds.length` — what a notification counts. */
  ensured: z.number().int().min(0),
  /**
   * Owner names the chief of sales said out loud that nothing resolved to a
   * user. Surfaced rather than written into the row: `ownerHint` is documented
   * as advisory and the interaction has no field for a name, so inventing prose
   * in the task body would be the command authoring CRM content.
   */
  unresolvedOwnerHints: z.array(z.string()),
})

export type EnsureTaskOutput = z.infer<typeof ensureTaskOutputSchema>

type ResolvedScope = {
  tenantId: string
  organizationId: string
}

function resolveScopeFromAuth(ctx: CommandRuntimeContext): ResolvedScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new Error(
      'sales_call_planner.ensure_task requires a tenant and organization on the workflow instance; ' +
        'the run carries none, so there is no scope to write into.',
    )
  }
  return { tenantId, organizationId }
}

function parseDueAt(task: TaskAction, index: number): Date | null {
  if (!task.dueAt) return null
  const parsed = new Date(task.dueAt)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `sales_call_planner.ensure_task received an unparseable dueAt on task ${index}: ${task.dueAt}. ` +
        'Expected an ISO-8601 instant.',
    )
  }
  return parsed
}

/**
 * Postgres `unique_violation`. Reached only when two invocations of the same
 * activity race each other between the existence read and the create; the loser
 * re-reads and updates. Walks the cause chain because MikroORM wraps the driver
 * error.
 */
function isDuplicateKeyError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 5) return false
  const candidate = error as { code?: unknown; name?: unknown; cause?: unknown; previous?: unknown }
  if (candidate.code === '23505') return true
  if (candidate.name === 'UniqueConstraintViolationException') return true
  return isDuplicateKeyError(candidate.cause, depth + 1) || isDuplicateKeyError(candidate.previous, depth + 1)
}

type CommandBusLike = {
  execute(commandId: string, options: { input: unknown; ctx: CommandRuntimeContext }): Promise<unknown>
}

function resolveCommandBus(ctx: CommandRuntimeContext): CommandBusLike {
  const bus = ctx.container.resolve('commandBus') as CommandBusLike | null
  if (!bus || typeof bus.execute !== 'function') {
    throw new Error('[internal] sales_call_planner.ensure_task requires a command bus in the container')
  }
  return bus
}

function buildCreateInput(params: {
  id: string
  scope: ResolvedScope
  entityId: string
  ownerUserId: string | null
  task: TaskAction
  index: number
}): Record<string, unknown> {
  return {
    id: params.id,
    tenantId: params.scope.tenantId,
    organizationId: params.scope.organizationId,
    entityId: params.entityId,
    interactionType: INTERACTION_TYPE_TASK,
    title: params.task.title,
    body: params.task.body ?? null,
    scheduledAt: parseDueAt(params.task, params.index),
    priority: toInteractionPriority(params.task.priority),
    ownerUserId: params.ownerUserId,
    dealId: params.task.dealId ?? null,
    source: ENSURE_TASK_SOURCE,
  }
}

/**
 * The rewrite path. Every field the create path sets is restated so a retry
 * against a changed input converges on the current input rather than leaving a
 * half-old row; `entityId` is absent because `interactionUpdateSchema` does not
 * accept it — a task cannot change its timeline parent.
 */
function buildUpdateInput(params: {
  id: string
  scope: ResolvedScope
  ownerUserId: string | null
  task: TaskAction
  index: number
}): Record<string, unknown> {
  return {
    id: params.id,
    tenantId: params.scope.tenantId,
    organizationId: params.scope.organizationId,
    interactionType: INTERACTION_TYPE_TASK,
    title: params.task.title,
    body: params.task.body ?? null,
    scheduledAt: parseDueAt(params.task, params.index),
    priority: toInteractionPriority(params.task.priority),
    ownerUserId: params.ownerUserId,
    dealId: params.task.dealId ?? null,
    source: ENSURE_TASK_SOURCE,
  }
}

async function readExistingRow(
  em: EntityManager,
  id: string,
  scope: ResolvedScope,
): Promise<{ deletedAt: Date | null } | null> {
  const row = await findOneWithDecryption(em, CustomerInteraction, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!row) return null
  return { deletedAt: row.deletedAt ?? null }
}

async function ensureOneTask(params: {
  ctx: CommandRuntimeContext
  em: EntityManager
  bus: CommandBusLike
  id: string
  scope: ResolvedScope
  entityId: string
  ownerUserId: string | null
  task: TaskAction
  index: number
}): Promise<EnsureTaskDisposition> {
  const { ctx, em, bus, id, scope, entityId, ownerUserId, task, index } = params

  const existing = await readExistingRow(em, id, scope)
  if (existing?.deletedAt) return 'skipped'

  if (existing) {
    await bus.execute(UPDATE_COMMAND_ID, {
      input: buildUpdateInput({ id, scope, ownerUserId, task, index }),
      ctx,
    })
    return 'updated'
  }

  try {
    await bus.execute(CREATE_COMMAND_ID, {
      input: buildCreateInput({ id, scope, entityId, ownerUserId, task, index }),
      ctx,
    })
    return 'created'
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    // A concurrent invocation of this same activity won the race. The row it
    // wrote is addressed by the same deterministic id, so converging on the
    // current input is exactly what a retry is supposed to do.
    await bus.execute(UPDATE_COMMAND_ID, {
      input: buildUpdateInput({ id, scope, ownerUserId, task, index }),
      ctx,
    })
    return 'updated'
  }
}

const ensureTaskCommand: CommandHandler<EnsureTaskInput, EnsureTaskOutput> = {
  id: 'sales_call_planner.ensure_task',
  outputSchema: ensureTaskOutputSchema,
  async execute(rawInput, ctx) {
    const parsed = ensureTaskInputSchema.parse(rawInput)
    const scope = resolveScopeFromAuth(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Resolve the timeline parent ONCE, before anything is written. Without it
    // the first create would fail on the same check anyway, but a run that
    // names a company from another tenant deserves a message that says so
    // rather than a bare "Customer not found" from three frames down.
    try {
      await requireTimelineParentEntity(em, parsed.entityId, scope)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `sales_call_planner.ensure_task could not resolve the company entity ${parsed.entityId} ` +
          `in this workflow's scope: ${reason}. entityId must be a customer_entities.id ` +
          '(the timeline parent), not a customer_companies.id.',
      )
    }

    const bus = resolveCommandBus(ctx)
    const ownerUserId = parsed.ownerUserId ?? null

    const taskIds: string[] = []
    const createdIds: string[] = []
    const updatedIds: string[] = []
    const skippedIds: string[] = []
    const unresolvedOwnerHints: string[] = []

    for (const [index, task] of parsed.tasks.entries()) {
      const id = deriveEnsureTaskId(parsed.workflowInstanceId, parsed.stepId, index)
      taskIds.push(id)
      if (!ownerUserId && task.ownerHint) unresolvedOwnerHints.push(task.ownerHint)

      const disposition = await ensureOneTask({
        ctx,
        em,
        bus,
        id,
        scope,
        entityId: parsed.entityId,
        ownerUserId,
        task,
        index,
      })

      if (disposition === 'created') createdIds.push(id)
      else if (disposition === 'updated') updatedIds.push(id)
      else skippedIds.push(id)
    }

    return {
      entityId: parsed.entityId,
      taskIds,
      createdIds,
      updatedIds,
      skippedIds,
      ensured: createdIds.length + updatedIds.length,
      unresolvedOwnerHints,
    }
  },
  /**
   * No `buildLog` / `undo` of its own. Every write this command performs already
   * went through `customers.interactions.create` / `.update`, each of which
   * wrote its own undoable `ActionLog` against the row it touched. A second log
   * here would either duplicate those entries or offer an undo that cannot
   * honour them.
   */
}

registerCommand(ensureTaskCommand)

export { ensureTaskCommand }
