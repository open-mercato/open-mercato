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
}

export type CommandLogMetadata = {
  tenantId?: string | null
  organizationId?: string | null
  actorUserId?: string | null
  actionLabel?: string | null
  resourceKind?: string | null
  resourceId?: string | null
  undoToken?: string | null
  payload?: unknown
  snapshotBefore?: unknown
  snapshotAfter?: unknown
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
}

export function defaultUndoToken(): string {
  return randomUUID()
}
