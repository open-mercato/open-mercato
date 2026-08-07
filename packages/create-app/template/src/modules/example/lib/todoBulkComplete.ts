import type { AwilixContainer } from 'awilix'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ExampleTodoBulkOperation, Todo } from '../data/entities'

export const EXAMPLE_TODO_BULK_COMPLETE_QUEUE = 'example-todos-bulk-complete'
export const EXAMPLE_TODO_BULK_DISPATCH_QUEUE = 'example-todos-bulk-dispatch'
export const EXAMPLE_TODO_BULK_JOB_TYPE = 'example.todos.bulk_complete'

/** How long one worker may hold the execution claim before another may steal it. */
export const TODO_BULK_LEASE_TTL_MS = 60_000
/** Result summaries are persisted and broadcast — keep them small and bounded. */
export const TODO_BULK_MAX_FAILED_ITEMS = 20
export const TODO_BULK_MAX_IDS = 500

const logger = createLogger('example.todos.bulk')
const queues = new Map<string, Queue<Record<string, unknown>>>()

export type TodoBulkScope = {
  tenantId: string
  organizationId: string
  userId: string
}

export type TodoBulkJobPayload = {
  operationId: string
  scope: TodoBulkScope
}

export type TodoBulkFailedItem = { id: string; code: string }

export type TodoBulkOutcome = {
  terminal: 'completed' | 'failed' | 'cancelled'
  summary: {
    affectedCount: number
    failedCount: number
    failedItems: TodoBulkFailedItem[]
  }
}

export function getExampleTodoBulkQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing
  const created = createModuleQueue<Record<string, unknown>>(queueName, { concurrency: 1 })
  queues.set(queueName, created)
  return created
}

/**
 * Failure classification kept deliberately coarse: the summary crosses a process
 * boundary and reaches the browser, so it carries stable codes rather than the
 * raw message of whatever threw.
 */
export function classifyTodoBulkFailure(error: unknown): string {
  if (isCrudHttpError(error)) {
    if (error.status === 409) return 'conflict'
    if (error.status === 404) return 'not_found'
    if (error.status === 403) return 'forbidden'
  }
  return 'error'
}

export function boundFailedItems(
  items: readonly TodoBulkFailedItem[],
  max: number = TODO_BULK_MAX_FAILED_ITEMS,
): TodoBulkFailedItem[] {
  if (max <= 0) return []
  return items.slice(0, max).map((item) => ({ id: item.id, code: item.code }))
}

/**
 * The terminal-state rule, isolated so it can be asserted directly.
 *
 * Mixed success/failure completes (the user got some of what they asked for and
 * the summary says which items did not land); only a run where nothing succeeded
 * and something failed is a job failure.
 */
export function resolveTodoBulkOutcome(input: {
  succeededCount: number
  failedItems: readonly TodoBulkFailedItem[]
  cancelled: boolean
}): TodoBulkOutcome {
  const failedItems = boundFailedItems(input.failedItems)
  const summary = {
    affectedCount: input.succeededCount,
    failedCount: input.failedItems.length,
    failedItems,
  }
  if (input.cancelled) return { terminal: 'cancelled', summary }
  if (input.succeededCount === 0 && input.failedItems.length > 0) {
    return { terminal: 'failed', summary }
  }
  return { terminal: 'completed', summary }
}

/**
 * A lease is stealable when nobody holds it, when it has expired, or when the
 * caller is the previous holder (queue retry of the same physical job).
 */
export function canAcquireTodoBulkLease(input: {
  leaseOwner: string | null | undefined
  leaseExpiresAt: Date | null | undefined
  candidateOwner: string
  now: Date
}): boolean {
  if (!input.leaseOwner) return true
  if (input.leaseOwner === input.candidateOwner) return true
  if (!input.leaseExpiresAt) return true
  return input.leaseExpiresAt.getTime() <= input.now.getTime()
}

export function isTodoBulkTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

/**
 * Rows the dispatcher must republish: never published, or published but abandoned
 * mid-flight (an expired lease on a non-terminal row).
 */
export function needsTodoBulkPublication(input: {
  status: string
  publishedAt: Date | null | undefined
  leaseOwner: string | null | undefined
  leaseExpiresAt: Date | null | undefined
  now: Date
}): boolean {
  if (isTodoBulkTerminal(input.status)) return false
  if (!input.publishedAt) return true
  if (!input.leaseOwner) return false
  if (!input.leaseExpiresAt) return false
  return input.leaseExpiresAt.getTime() <= input.now.getTime()
}

export type TodoBulkPublicationCandidate = {
  id: string
  status: string
  publishedAt?: Date | null
  leaseOwner?: string | null
  leaseExpiresAt?: Date | null
}

export function selectTodoBulkOperationsToPublish<T extends TodoBulkPublicationCandidate>(
  rows: readonly T[],
  now: Date,
): T[] {
  return rows.filter((row) =>
    needsTodoBulkPublication({
      status: row.status,
      publishedAt: row.publishedAt,
      leaseOwner: row.leaseOwner,
      leaseExpiresAt: row.leaseExpiresAt,
      now,
    }),
  )
}

export type ProgressServiceLike = {
  createJob: (input: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<{ id: string }>
  startJob: (jobId: string, ctx: Record<string, unknown>) => Promise<unknown>
  updateProgress: (jobId: string, input: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>
  completeJob: (jobId: string, input: Record<string, unknown> | undefined, ctx: Record<string, unknown>) => Promise<unknown>
  failJob: (jobId: string, input: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>
  markCancelled: (jobId: string, ctx: Record<string, unknown>) => Promise<unknown>
  isCancellationRequested: (jobId: string, tenantId: string, organizationId?: string | null) => Promise<boolean>
}

/**
 * The persistence surface the execution loop needs, declared structurally so the
 * loop is drivable by a fake in tests instead of a live database.
 */
export type TodoBulkOperationStore = {
  load: (operationId: string, scope: TodoBulkScope) => Promise<ExampleTodoBulkOperationSnapshot | null>
  acquireLease: (
    operationId: string,
    scope: TodoBulkScope,
    owner: string,
    expiresAt: Date,
  ) => Promise<boolean>
  saveCheckpoint: (
    operationId: string,
    scope: TodoBulkScope,
    checkpoint: {
      nextItemIndex: number
      succeededCount: number
      failedCount: number
      failedItems: TodoBulkFailedItem[]
      leaseExpiresAt: Date
    },
  ) => Promise<void>
  finish: (
    operationId: string,
    scope: TodoBulkScope,
    result: { status: TodoBulkOutcome['terminal']; summary: TodoBulkOutcome['summary'] },
  ) => Promise<void>
}

export type ExampleTodoBulkOperationSnapshot = {
  id: string
  status: string
  progressJobId: string
  todoIds: string[]
  nextItemIndex: number
  succeededCount: number
  failedCount: number
  failedItems: TodoBulkFailedItem[]
}

export type TodoBulkExecutor = (todoId: string) => Promise<void>

export type RunTodoBulkResult = {
  outcome: TodoBulkOutcome | null
  /** `false` when this invocation did not own the operation and did no work. */
  executed: boolean
}

/**
 * Leased, checkpointed execution loop.
 *
 * Everything durable is injected, so this function is the whole behavior under
 * test: lease refusal, resume-from-checkpoint, cancellation between items,
 * per-item failure classification, and terminal-state selection.
 */
export async function runTodoBulkCompleteLoop(params: {
  operationId: string
  scope: TodoBulkScope
  leaseOwner: string
  store: TodoBulkOperationStore
  progress: ProgressServiceLike
  execute: TodoBulkExecutor
  now?: () => Date
  leaseTtlMs?: number
}): Promise<RunTodoBulkResult> {
  const now = params.now ?? (() => new Date())
  const leaseTtlMs = params.leaseTtlMs ?? TODO_BULK_LEASE_TTL_MS
  const operation = await params.store.load(params.operationId, params.scope)
  if (!operation) return { outcome: null, executed: false }
  if (isTodoBulkTerminal(operation.status)) return { outcome: null, executed: false }

  const leased = await params.store.acquireLease(
    params.operationId,
    params.scope,
    params.leaseOwner,
    new Date(now().getTime() + leaseTtlMs),
  )
  if (!leased) return { outcome: null, executed: false }

  const progressContext = {
    tenantId: params.scope.tenantId,
    organizationId: params.scope.organizationId,
    userId: params.scope.userId,
  }
  await params.progress.startJob(operation.progressJobId, progressContext)
  await params.progress.updateProgress(
    operation.progressJobId,
    { totalCount: operation.todoIds.length, processedCount: operation.nextItemIndex },
    progressContext,
  )

  let succeededCount = operation.succeededCount
  const failedItems: TodoBulkFailedItem[] = [...operation.failedItems]
  let failedCount = operation.failedCount
  let index = operation.nextItemIndex
  let cancelled = false

  while (index < operation.todoIds.length) {
    const cancellationRequested = await params.progress.isCancellationRequested(
      operation.progressJobId,
      params.scope.tenantId,
      params.scope.organizationId,
    )
    if (cancellationRequested) {
      cancelled = true
      break
    }

    const todoId = operation.todoIds[index]
    try {
      await params.execute(todoId)
      succeededCount += 1
    } catch (error) {
      failedCount += 1
      failedItems.push({ id: todoId, code: classifyTodoBulkFailure(error) })
      logger.warn('Todo bulk-complete item failed', {
        operationId: params.operationId,
        todoId,
        err: error,
      })
    }

    index += 1
    await params.store.saveCheckpoint(params.operationId, params.scope, {
      nextItemIndex: index,
      succeededCount,
      failedCount,
      failedItems: boundFailedItems(failedItems),
      leaseExpiresAt: new Date(now().getTime() + leaseTtlMs),
    })
    await params.progress.updateProgress(
      operation.progressJobId,
      { totalCount: operation.todoIds.length, processedCount: index },
      progressContext,
    )
  }

  const outcome = resolveTodoBulkOutcome({ succeededCount, failedItems, cancelled })
  await params.store.finish(params.operationId, params.scope, {
    status: outcome.terminal,
    summary: outcome.summary,
  })

  if (outcome.terminal === 'cancelled') {
    await params.progress.markCancelled(operation.progressJobId, progressContext)
  } else if (outcome.terminal === 'failed') {
    await params.progress.failJob(
      operation.progressJobId,
      { errorMessage: 'example.todos.bulkComplete.allFailed' },
      progressContext,
    )
  } else {
    await params.progress.completeJob(
      operation.progressJobId,
      { resultSummary: outcome.summary },
      progressContext,
    )
  }

  return { outcome, executed: true }
}

export function createTodoBulkOperationStore(em: EntityManager): TodoBulkOperationStore {
  const scopeFilter = (operationId: string, scope: TodoBulkScope) => ({
    id: operationId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  return {
    async load(operationId, scope) {
      const row = await em.fork().findOne(ExampleTodoBulkOperation, scopeFilter(operationId, scope))
      if (!row) return null
      return {
        id: row.id,
        status: row.status,
        progressJobId: row.progressJobId,
        todoIds: Array.isArray(row.todoIds) ? row.todoIds : [],
        nextItemIndex: row.nextItemIndex,
        succeededCount: row.succeededCount,
        failedCount: row.failedCount,
        failedItems: Array.isArray(row.failedItems) ? row.failedItems : [],
      }
    },
    async acquireLease(operationId, scope, owner, expiresAt) {
      const isolated = em.fork()
      const now = new Date()
      // Compare-and-swap: only a free, expired, or self-owned lease is claimable,
      // and the claim is the same statement as the read so two workers cannot both win.
      const claimed = await isolated.nativeUpdate(
        ExampleTodoBulkOperation,
        {
          ...scopeFilter(operationId, scope),
          status: { $in: ['pending', 'running'] },
          $or: [
            { leaseOwner: null },
            { leaseOwner: owner },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { $lte: now } },
          ],
        } as FilterQuery<ExampleTodoBulkOperation>,
        { leaseOwner: owner, leaseExpiresAt: expiresAt, status: 'running', updatedAt: now },
      )
      return claimed > 0
    },
    async saveCheckpoint(operationId, scope, checkpoint) {
      await em.fork().nativeUpdate(
        ExampleTodoBulkOperation,
        scopeFilter(operationId, scope),
        {
          nextItemIndex: checkpoint.nextItemIndex,
          succeededCount: checkpoint.succeededCount,
          failedCount: checkpoint.failedCount,
          failedItems: checkpoint.failedItems,
          leaseExpiresAt: checkpoint.leaseExpiresAt,
          updatedAt: new Date(),
        },
      )
    },
    async finish(operationId, scope, result) {
      await em.fork().nativeUpdate(
        ExampleTodoBulkOperation,
        scopeFilter(operationId, scope),
        {
          status: result.status,
          succeededCount: result.summary.affectedCount,
          failedCount: result.summary.failedCount,
          failedItems: result.summary.failedItems,
          // Clearing the lease makes a duplicate physical message a no-op: the
          // row is terminal, so `runTodoBulkCompleteLoop` returns before leasing.
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        },
      )
    },
  }
}

export type TodoBulkClaim = {
  operationId: string
  progressJobId: string
  /** `false` when an earlier identical request already created this operation. */
  created: boolean
}

/**
 * Create-or-reuse the durable operation for one `(scope, idempotencyKey)`.
 *
 * The uniqueness is enforced by the database, not by a read-then-write check, so
 * two concurrent identical requests converge on one row and one progress job even
 * when they interleave. The loser cancels the progress job it optimistically
 * created so a duplicate never leaves a phantom entry in the top bar.
 */
export async function claimTodoBulkOperation(params: {
  em: EntityManager
  progress: ProgressServiceLike
  scope: TodoBulkScope
  idempotencyKey: string
  todoIds: string[]
}): Promise<TodoBulkClaim> {
  const uniqueFilter = {
    tenantId: params.scope.tenantId,
    organizationId: params.scope.organizationId,
    userId: params.scope.userId,
    idempotencyKey: params.idempotencyKey,
  } as FilterQuery<ExampleTodoBulkOperation>

  const existing = await params.em.fork().findOne(ExampleTodoBulkOperation, uniqueFilter)
  if (existing) {
    return { operationId: existing.id, progressJobId: existing.progressJobId, created: false }
  }

  const progressContext = {
    tenantId: params.scope.tenantId,
    organizationId: params.scope.organizationId,
    userId: params.scope.userId,
  }
  const progressJob = await params.progress.createJob(
    {
      jobType: EXAMPLE_TODO_BULK_JOB_TYPE,
      name: 'Mark selected todos done',
      description: `${params.todoIds.length} todos queued for completion`,
      totalCount: params.todoIds.length,
      cancellable: true,
      meta: { source: 'example.todos.bulk-complete', idempotencyKey: params.idempotencyKey },
    },
    progressContext,
  )

  const isolated = params.em.fork()
  const operation = isolated.create(ExampleTodoBulkOperation, {
    tenantId: params.scope.tenantId,
    organizationId: params.scope.organizationId,
    userId: params.scope.userId,
    idempotencyKey: params.idempotencyKey,
    todoIds: params.todoIds,
    progressJobId: progressJob.id,
    status: 'pending',
    publishAttempts: 0,
    nextItemIndex: 0,
    succeededCount: 0,
    failedCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  try {
    isolated.persist(operation)
    await isolated.flush()
  } catch (error) {
    const winner = await params.em.fork().findOne(ExampleTodoBulkOperation, uniqueFilter)
    if (!winner) throw error
    await params.progress.markCancelled(progressJob.id, progressContext)
    return { operationId: winner.id, progressJobId: winner.progressJobId, created: false }
  }

  return { operationId: operation.id, progressJobId: progressJob.id, created: true }
}

/** Records one publication attempt; `published` marks the outbox row delivered. */
export async function recordTodoBulkPublication(params: {
  em: EntityManager
  operationId: string
  scope: TodoBulkScope
  published: boolean
}): Promise<void> {
  const now = new Date()
  await params.em.fork().nativeUpdate(
    ExampleTodoBulkOperation,
    {
      id: params.operationId,
      tenantId: params.scope.tenantId,
      organizationId: params.scope.organizationId,
    } as FilterQuery<ExampleTodoBulkOperation>,
    {
      lastPublishAttemptAt: now,
      publishAttempts: params.published ? 1 : 0,
      ...(params.published ? { publishedAt: now } : {}),
      updatedAt: now,
    },
  )
}

/**
 * Publish the operation to the execution queue and record the attempt.
 *
 * Deliberately at-least-once: a crash between `enqueue` and the publication write
 * leaves the row unpublished, so the scheduler dispatcher republishes it and the
 * queue sees the message twice. The execution lease makes that harmless.
 */
export async function publishTodoBulkOperation(params: {
  em: EntityManager
  operationId: string
  scope: TodoBulkScope
}): Promise<boolean> {
  try {
    await getExampleTodoBulkQueue(EXAMPLE_TODO_BULK_COMPLETE_QUEUE).enqueue({
      operationId: params.operationId,
      scope: params.scope,
    })
  } catch (error) {
    logger.warn('Todo bulk-complete publication failed; leaving row for the dispatcher', {
      operationId: params.operationId,
      err: error,
    })
    await recordTodoBulkPublication({ ...params, published: false })
    return false
  }
  await recordTodoBulkPublication({ ...params, published: true })
  return true
}

function buildCommandContext(scope: TodoBulkScope, container: AwilixContainer): CommandRuntimeContext {
  return {
    container,
    auth: {
      sub: scope.userId,
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
    },
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

/**
 * Marks one Todo done through the existing `example.todos.update` command, with
 * that record's own `updated_at` as the expected version. Running through the
 * command keeps audit, undo, events, cache and index invalidation intact — a
 * direct ORM loop here would silently skip all five.
 */
export function createTodoBulkExecutor(params: {
  container: AwilixContainer
  scope: TodoBulkScope
}): TodoBulkExecutor {
  const em = params.container.resolve('em') as EntityManager
  const commandBus = params.container.resolve('commandBus') as CommandBus
  const commandContext = buildCommandContext(params.scope, params.container)

  return async (todoId: string) => {
    const current = await em.fork().findOne(Todo, {
      id: todoId,
      tenantId: params.scope.tenantId,
      organizationId: params.scope.organizationId,
      deletedAt: null,
    } as FilterQuery<Todo>)
    if (!current) throw notFound('[internal] Todo not found for bulk completion')
    // Already done is an idempotent success — a retried message must not fail.
    if (current.isDone) return

    await commandBus.execute('example.todos.update', {
      input: {
        id: todoId,
        is_done: true,
        expected_updated_at: current.updatedAt instanceof Date
          ? current.updatedAt.toISOString()
          : current.updatedAt,
      },
      ctx: commandContext,
    })
  }
}
