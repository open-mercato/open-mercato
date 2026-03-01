import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'

export interface CommandInterceptor {
  /** Unique interceptor ID (e.g., 'example.log-customer-saves', 'compliance.block-inactive-edits') */
  id: string

  /** Target command ID pattern. Supports exact, module wildcard (customers.*), global wildcard (*) */
  targetCommand: string

  /** Execution priority (lower = earlier). Default: 50 */
  priority?: number

  /** ACL feature gating — interceptor only runs if user has these features */
  features?: string[]

  /** Hook before command execute(). Can block or modify input. */
  beforeExecute?(
    input: unknown,
    context: CommandInterceptorContext,
  ): Promise<CommandInterceptorBeforeResult | void>

  /** Hook after command execute(). Can augment result or trigger side-effects. */
  afterExecute?(
    input: unknown,
    result: unknown,
    context: CommandInterceptorContext,
  ): Promise<CommandInterceptorAfterResult | void>

  /** Hook before command undo(). Can block undo. */
  beforeUndo?(
    undoContext: CommandInterceptorUndoContext,
    context: CommandInterceptorContext,
  ): Promise<CommandInterceptorBeforeResult | void>

  /** Hook after command undo(). Trigger cleanup or side-effects. */
  afterUndo?(
    undoContext: CommandInterceptorUndoContext,
    context: CommandInterceptorContext,
  ): Promise<void>
}

export interface CommandInterceptorContext {
  /** The resolved command ID being executed */
  commandId: string
  /** Current user auth context */
  auth: AuthContext | null
  /** Organization scope */
  organizationScope: OrganizationScope | null
  /** Selected organization ID */
  selectedOrganizationId: string | null
  /** DI container (read-only usage recommended) */
  container: AwilixContainer
  /** Metadata passthrough from beforeExecute to afterExecute (or beforeUndo to afterUndo) */
  metadata?: Record<string, unknown>
}

export interface CommandInterceptorUndoContext {
  /** The original input used when the command was executed */
  input: unknown
  /** The action log entry being undone */
  logEntry: unknown
  /** The undo token */
  undoToken: string
}

export interface CommandInterceptorBeforeResult {
  /** If false, blocks the command. Default: true */
  ok?: boolean
  /** Error message when blocking */
  message?: string
  /** Modified input — shallow-merged into command input if ok:true */
  modifiedInput?: Record<string, unknown>
  /** Metadata passed to the corresponding after hook */
  metadata?: Record<string, unknown>
}

export interface CommandInterceptorAfterResult {
  /** Modified result — shallow-merged into command result */
  modifiedResult?: Record<string, unknown>
  /** Metadata (for logging/debugging — not passed further) */
  metadata?: Record<string, unknown>
}
