import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { randomUUID } from 'crypto'
import type { AuthContext } from '../auth/server'
import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'

export type CommandRuntimeContext = {
  container: AwilixContainer
  auth: AuthContext | null
  organizationScope: OrganizationScope | null
  selectedOrganizationId: string | null
  organizationIds: string[] | null
  request?: Request
  syncOrigin?: string | null
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

export interface CommandHandler<TInput = unknown, TResult = unknown> {
  readonly id: string
  readonly isUndoable?: boolean
  prepare?(input: TInput, ctx: CommandRuntimeContext): Promise<{ before?: unknown } | null> | { before?: unknown } | null
  execute(input: TInput, ctx: CommandRuntimeContext): Promise<TResult> | TResult
  buildLog?(args: CommandLogBuilderArgs<TInput, TResult>): Promise<CommandLogMetadata | null | undefined> | CommandLogMetadata | null | undefined
  captureAfter?(input: TInput, result: TResult, ctx: CommandRuntimeContext): Promise<unknown> | unknown
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
