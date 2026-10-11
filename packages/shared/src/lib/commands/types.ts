import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ZodTypeAny } from 'zod'
import { randomUUID } from 'crypto'
import type { AuthContext } from '../auth/server'
import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { TransactionLifetime } from './transaction-lifetime'

/**
 * Bulk-import / backfill deferral flags. When a command runs under a context that
 * carries this, the command bus and data engine suppress the heavy per-record side
 * effects flagged below so a large backfill can defer them to a single batched pass.
 *
 * IMPORTANT — the caller owns restoring whatever it suppresses. With `skipReindex`
 * the `query_index` projection (and its search tokens) is stale for every record
 * written under this context until the caller runs a batched `query_index rebuild`
 * for the affected entity types at end-of-run.
 *
 * Concurrency: these flags are read from the context and threaded as a local
 * parameter through the side-effect flush — no shared engine state is mutated — so
 * two commands running concurrently with different flags never clobber each other.
 */
export type BulkImportSuppression = {
  /** Skip the inline `query_index.upsert_one` / `delete_one` reindex (rebuild after the run). */
  skipReindex?: boolean
  /** Skip the per-record `<module>.<entity>.<action>` domain event emission. */
  skipEvents?: boolean
  /** Advisory: handlers that fan out per-record notifications SHOULD honor this and skip them. */
  skipNotifications?: boolean
  /**
   * Skip a command's own full-collection derived-data rebuild (e.g. category tree
   * `parentId`/`treePath`/`depth`/ancestor-descendant rewrite). The caller MUST run that rebuild
   * itself exactly once after the batch, in a `finally` that covers the completed, cancelled and
   * failed paths — otherwise every record written under this context is left with a stale
   * derived shape.
   */
  skipDerivedRebuild?: boolean
}

export type CommandRuntimeContext = {
  container: AwilixContainer
  auth: AuthContext | null
  organizationScope: OrganizationScope | null
  selectedOrganizationId: string | null
  organizationIds: string[] | null
  request?: Request
  syncOrigin?: string | null
  /**
   * See {@link BulkImportSuppression}. Set by bulk backfill callers to defer heavy
   * per-record side effects (reindex, events, notifications). The caller MUST rebuild
   * the `query_index` for the affected entity types after the run when `skipReindex`
   * is set. Unset for normal (interactive) writes — they get all side effects.
   */
  bulkImport?: BulkImportSuppression
  /**
   * Marks a trusted server-side invocation (CLI seeding, tenant setup) that runs
   * without an authenticated end-user actor. Commands that gate writes behind a
   * privileged actor (e.g. super-admin-only platform tables) may treat this as
   * an explicit system grant. HTTP request paths MUST NOT set this — they always
   * carry a real `auth` actor, so a present-but-unprivileged actor stays denied.
   */
  systemActor?: boolean
  /**
   * When set, command handlers that support it MUST run their writes within this
   * existing transactional EntityManager (reusing its row locks) instead of
   * opening their own transaction. Lets a caller compose a command with its own
   * surrounding work as a single atomic, single-locked operation.
   */
  transactionalEm?: EntityManager
  /**
   * Identifies the owner of an already-active {@link transactionalEm} lifetime.
   * Atomic replay accepts an ambient EntityManager only when this is the exact
   * token returned by `getTransactionLifetime(transactionalEm)` from the outer
   * `withAtomicFlush` phase. The owner completes the token after its real commit
   * or rollback, allowing replay leases and post-commit work to follow that
   * boundary. Omit when the command bus opens and owns the transaction itself.
   */
  transactionLifetime?: TransactionLifetime
  /**
   * Optional request-level replay authorization that the command bus binds to
   * its replay EntityManager. Atomic handlers run this guard in the same
   * transaction as the source-log transition and domain mutation; legacy
   * handlers run it in a dedicated read transaction before preserving their
   * existing replay lifecycle.
   */
  replayTransactionGuard?: (args: {
    operation: CommandReplayOperation
    logEntry: CommandUndoLogEntry
    transactionalEm: EntityManager
  }) => Promise<void> | void
  /**
   * On-behalf-of attribution for non-human principals (Agent Identity &
   * On-Behalf-Of, Wave 4 P2). When an agent runs on behalf of a human, the
   * orchestrator's `runAs` wrapper sets this so every `ActionLog` the command
   * path writes records `actorUserId = runAs.actorUserId` (the agent principal's
   * `auth.User` id), `onBehalfOfUserId = runAs.onBehalfOfUserId` (the invoking
   * human, or null for system-invoked agents), and `sourceKey = runAs.source`
   * (`'agent'`). Additive + optional: callers that omit it keep the existing
   * `ctx.auth.sub`-derived attribution unchanged. This threads agent attribution
   * through the SAME audited Command/CRUD path as a human action — not a parallel
   * audit path.
   */
  runAs?: CommandRunAsContext
}

export type CommandRunAsContext = {
  /** The actor stamped on every ActionLog this context produces (agent `auth.User` id). */
  actorUserId: string
  /** The human (or system) principal the actor acts on behalf of; null when system-invoked. */
  onBehalfOfUserId?: string | null
  /** The audit source key for the attributed writes; `'agent'` for agent runs. */
  source: 'agent'
}

export type CommandLogMetadata = {
  skipLog?: boolean
  /**
   * Per-execution replay policy. `false` records the audit entry without an undo
   * token or command payload, so neither undo nor redo can replay sensitive input.
   * Omitted preserves the command handler's existing replay behavior.
   */
  replayable?: boolean
  /**
   * Overrides the command input persisted in the audit entry's redo envelope.
   * The default is the raw input, which for credential-bearing commands would put
   * a plaintext secret at rest in `action_logs`. A handler that still wants its
   * operation to be undoable supplies a redacted projection here instead of
   * switching the whole entry to `replayable: false` — suppressing the undo token
   * removes the operator's ability to revert a write that carries no secret of its
   * own (undoing a user create only deletes a row).
   */
  redoInput?: unknown
  tenantId?: string | null
  organizationId?: string | null
  actorUserId?: string | null
  onBehalfOfUserId?: string | null
  actionLabel?: string | null
  resourceKind?: string | null
  resourceId?: string | null
  parentResourceKind?: string | null
  parentResourceId?: string | null
  undoToken?: string | null
  payload?: unknown
  snapshotBefore?: unknown
  snapshotAfter?: unknown
  relatedResourceKind?: string | null
  relatedResourceId?: string | null
  changes?: Record<string, unknown> | null
  context?: Record<string, unknown> | null
}

export type CommandExecuteResult<TResult> = {
  result: TResult
  logEntry: any | null
  /**
   * True when an atomic redo finalized its source action log in the same
   * transaction as the domain mutation and the newly persisted log entry, and
   * that transaction has committed. An ambient replay returns this as false
   * while its caller-owned transaction is still active; the returned result
   * object is updated to true by the owner's commit callback. It remains false
   * on rollback. Callers that historically finalized redo themselves can use
   * this additive signal to avoid a redundant post-commit write.
   */
  replaySourceFinalized?: boolean
}

/**
 * Shape of the persisted action log handed to a command's `undo()` handler.
 *
 * IMPORTANT: there is intentionally **no `payload` field**. `buildLog()` returns
 * a `payload` in its metadata, but the command bus persists that under
 * `commandPayload` (column `command_payload`, wrapped in a redo envelope) — the
 * stored row never has a top-level `payload`. Reading `logEntry.payload` in an
 * undo handler is therefore always `undefined` and silently no-ops the undo
 * (issue #2504). Always read the undo snapshot through
 * `extractUndoPayload(logEntry)` from `@open-mercato/shared/lib/commands/undo`,
 * which unwraps `commandPayload`/snapshots correctly. Omitting `payload` here
 * makes the footgun a compile-time error instead of a runtime silent failure.
 */
export type CommandUndoLogEntry = {
  id?: string
  commandId?: string
  commandPayload?: unknown | null
  snapshotBefore?: unknown | null
  snapshotAfter?: unknown | null
  resourceKind?: string | null
  resourceId?: string | null
  undoToken?: string | null
  actionLabel?: string | null
  tenantId?: string | null
  organizationId?: string | null
  actorUserId?: string | null
  changesJson?: Record<string, unknown> | null
  contextJson?: Record<string, unknown> | null
  createdAt?: Date | string
  updatedAt?: Date | string
}

export type CommandLogBuilderArgs<TInput, TResult> = {
  input: TInput
  result: TResult
  ctx: CommandRuntimeContext
  snapshots: {
    before?: unknown
    after?: unknown
  }
}

export type CommandReplayOperation = 'undo' | 'redo'

export type CommandReplayAuthorizationArgs<TInput> = {
  operation: CommandReplayOperation
  input: TInput
  ctx: CommandRuntimeContext
  logEntry: CommandUndoLogEntry
}

export interface CommandHandler<TInput = unknown, TResult = unknown> {
  readonly id: string
  readonly isUndoable?: boolean
  /**
   * Opts replay into the command bus's transaction-bound lifecycle. The source
   * action-log transition, handler mutation, and any new replay log share one
   * EntityManager and commit or roll back together. Handlers that enable this
   * MUST reuse `ctx.transactionalEm` for every replay-time database operation.
   * Omitted preserves the legacy non-atomic replay path.
   */
  readonly atomicReplay?: boolean
  /**
   * Acquires every authorization-state lock needed by an atomic replay before
   * request-level replay authorization and feature-gated interceptors run.
   * Implementations MUST discover their complete actor/target/destination set
   * before taking the first lock and MUST reuse `ctx.transactionalEm`.
   * Omitted preserves the existing lifecycle for handlers that do not need
   * domain-specific authorization stabilization.
   */
  stabilizeReplay?(params: CommandReplayAuthorizationArgs<TInput>): Promise<void> | void
  /**
   * Optional Zod schema describing the command's return value. Feeds the
   * workflows context ledger so downstream activities can reason about the
   * shape a command produces; when absent the ledger renders the output as
   * unknown.
   */
  readonly outputSchema?: ZodTypeAny
  prepare?(input: TInput, ctx: CommandRuntimeContext): Promise<{ before?: unknown } | null> | { before?: unknown } | null
  execute(input: TInput, ctx: CommandRuntimeContext): Promise<TResult> | TResult
  buildLog?(args: CommandLogBuilderArgs<TInput, TResult>): Promise<CommandLogMetadata | null | undefined> | CommandLogMetadata | null | undefined
  captureAfter?(input: TInput, result: TResult, ctx: CommandRuntimeContext): Promise<unknown> | unknown
  /**
   * Re-authorizes a stored command against the actor and resource state that
   * exist at replay time. Legacy handlers are checked before claiming an undo
   * log or beginning redo processing. Atomic handlers are checked inside their
   * replay transaction before the guarded source transition; their mutation
   * path can repeat the check after taking domain locks. Throwing aborts replay
   * without committed domain side effects.
   */
  authorizeReplay?(params: CommandReplayAuthorizationArgs<TInput>): Promise<void> | void
  undo?(params: { input: TInput; ctx: CommandRuntimeContext; logEntry: CommandUndoLogEntry }): Promise<void> | void
  /**
   * Optional redo handler. When defined, the command bus calls this instead of
   * `execute()` while replaying a previously undone action (the redo route passes
   * `redoLogEntry` in the execution options). It receives the source action log so
   * it can re-materialize the original record **reusing its id** — for a create
   * command this restores the soft-deleted row (or re-creates it from the
   * `snapshotAfter`) instead of minting a new id, keeping undo/redo snapshots and
   * references stable (issue #2506, invariant I6). Handlers without `redo` keep the
   * legacy behavior of replaying `execute(__redoInput)`.
   */
  redo?(params: { input: TInput; ctx: CommandRuntimeContext; logEntry: CommandUndoLogEntry }): Promise<TResult> | TResult
}

export type CommandExecutionOptions<TInput> = {
  input: TInput
  ctx: CommandRuntimeContext
  metadata?: CommandLogMetadata | null
  skipCacheInvalidation?: boolean
  /**
   * When set, marks this execution as a redo of a previously undone action. If the
   * resolved handler defines a `redo` method, the command bus calls
   * `handler.redo({ input, ctx, logEntry })` instead of `handler.execute(...)`. The
   * rest of the pipeline (snapshots, buildLog, undo-token minting, persistence,
   * cache invalidation, side effects) is identical, so the fresh log entry — and
   * the `x-om-operation` header derived from it — automatically carry the restored
   * resourceId. Ignored when the handler has no `redo` method (legacy replay path).
   */
  redoLogEntry?: CommandUndoLogEntry | null
}

export function defaultUndoToken(): string {
  return randomUUID()
}
