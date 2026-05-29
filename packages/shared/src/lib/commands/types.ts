import type { AwilixContainer } from 'awilix'
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
}

export type CommandLogMetadata = {
  skipLog?: boolean
  tenantId?: string | null
  organizationId?: string | null
  actorUserId?: string | null
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
  undo?(params: { input: TInput; ctx: CommandRuntimeContext; logEntry: any }): Promise<void> | void
}

export type CommandExecutionOptions<TInput> = {
  input: TInput
  ctx: CommandRuntimeContext
  metadata?: CommandLogMetadata | null
  skipCacheInvalidation?: boolean
}

export function defaultUndoToken(): string {
  return randomUUID()
}
