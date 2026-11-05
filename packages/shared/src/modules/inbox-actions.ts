import type { z } from 'zod'

/**
 * Context passed to inbox action handlers during execution.
 * Uses unknown for ORM/DI types to avoid domain dependencies in shared.
 */
export interface InboxActionExecutionContext {
  em: unknown
  userId: string
  tenantId: string
  organizationId: string
  eventBus?: unknown
  container: unknown
  auth?: unknown
  executeCommand: <TInput, TResult>(commandId: string, input: TInput) => Promise<TResult>
  resolveEntityClass: <T>(key: string) => (new (...args: unknown[]) => T) | null
}

export interface InboxActionExecutionResult {
  createdEntityId?: string | null
  createdEntityType?: string | null
  matchedEntityId?: string | null
  matchedEntityType?: string | null
}

export interface InboxActionDefinition {
  /** Unique action type ID, e.g. 'create_order' */
  type: string
  /** RBAC feature required to execute this action */
  requiredFeature: string
  /** Zod schema for payload validation */
  payloadSchema: z.ZodType
  /** Human-readable label for UI */
  label?: string
  /** LLM prompt schema description (included in extraction prompt) */
  promptSchema: string
  /** LLM extraction rules specific to this action type */
  promptRules?: string[]
  /** Normalize LLM-generated payload before Zod validation */
  normalizePayload?: (
    payload: Record<string, unknown>,
    ctx: InboxActionExecutionContext,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>
  /** Execute the action after payload validation */
  execute: (
    action: { id: string; proposalId: string; payload: unknown },
    ctx: InboxActionExecutionContext,
  ) => Promise<InboxActionExecutionResult>
}

export interface InboxActionsModuleConfig {
  actions: InboxActionDefinition[]
}
