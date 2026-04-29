import type { z } from 'zod'
import type { AwilixContainer } from 'awilix'

/**
 * Execution context for MCP tool calls.
 * Includes tenant/org scope, user info, and DI container.
 */
export interface McpToolContext {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
  /** API key secret for authenticating HTTP requests to internal APIs */
  apiKeySecret?: string
  /** Session token for memory layer (deduplication of search/GET calls) */
  sessionId?: string
  /**
   * Back-reference to the tool definition the handler is executing. Populated
   * by the runtime (`tool-executor`, `pending-action-executor`, the agent-tools
   * dispatcher, and the test runner) so handlers can construct an
   * `AiToolExecutionContext` for `createAiApiOperationRunner` without losing
   * `requiredFeatures` coverage at the route gate.
   */
  tool?: AiToolDefinition
}

/**
 * Tool definition that modules register.
 */
export interface McpToolDefinition<TInput = unknown, TOutput = unknown> {
  /** Unique tool identifier (e.g., 'customers.search', 'sales.createOrder') */
  name: string
  /** Human-readable description for the MCP client */
  description: string
  /** Zod schema for input validation */
  inputSchema: z.ZodType<TInput>
  /** Required features to execute this tool */
  requiredFeatures?: string[]
  /** The actual handler function */
  handler: (input: TInput, context: McpToolContext) => Promise<TOutput>
}

/**
 * Per-record batch-diff descriptor returned by `loadBeforeRecords` on a bulk
 * mutation tool (Step 5.6 `prepareMutation`). Shape is a strict prefix of the
 * stored `AiPendingActionRecordDiff` — `prepareMutation` fills in the per-field
 * diff itself after matching the patch payload from `toolCallArgs.records[]`.
 */
export interface AiToolLoadBeforeRecord {
  recordId: string
  entityType: string
  label: string
  recordVersion: string | null
  before: Record<string, unknown>
}

/**
 * Single-record before-snapshot returned by `loadBeforeRecord` on a mutation
 * tool. Used by `prepareMutation` to compute a per-field diff against the
 * proposed patch in `toolCallArgs`. Tools that do not declare this resolver
 * fall back to `fieldDiff: []` with a `sideEffectsSummary` warning.
 */
export interface AiToolLoadBeforeSingleRecord {
  recordId: string
  entityType: string
  recordVersion: string | null
  before: Record<string, unknown>
}

/**
 * Public MCP-compatible tool definition consumed by `ai-tools.ts` files and
 * `defineAiTool()`. Extends `McpToolDefinition` with optional focused-agent
 * metadata. All additive fields are optional so existing plain-object
 * definitions remain valid and backward compatible.
 *
 * @example
 * ```typescript
 * import type { AiToolDefinition } from '@open-mercato/ai-assistant'
 *
 * export const aiTools: AiToolDefinition[] = [...]
 * ```
 */
export interface AiToolDefinition<TInput = unknown, TOutput = unknown>
  extends McpToolDefinition<TInput, TOutput> {
  /** Human-friendly label for UI surfaces (falls back to `name`). */
  displayName?: string
  /** Free-form tags used by routing/search layers (e.g. `['read', 'catalog']`). */
  tags?: string[]
  /**
   * True when the tool performs a mutation. Defaults to false.
   * Mutation-capable tools are not automatically allowed in v1 focused agents
   * and must be explicitly whitelisted via the agent's `allowedTools`.
   */
  isMutation?: boolean
  /**
   * True when the tool acts on multiple records in a single call. Routes the
   * `prepareMutation` wrapper into the batch code path (Step 5.6) — the tool
   * MUST carry `loadBeforeRecords` and emit a `records[]` array in its input.
   * Defaults to `false`.
   */
  isBulk?: boolean
  /**
   * Optional single-record before-snapshot resolver used by `prepareMutation`
   * to compute a `fieldDiff[]` against the proposed patch in `toolCallArgs`.
   * When absent, the preview card ships with `fieldDiff: []` and a
   * `sideEffectsSummary` fallback message (spec Phase 3 WS-C §9).
   */
  loadBeforeRecord?: (
    input: TInput,
    context: McpToolContext,
  ) => Promise<AiToolLoadBeforeSingleRecord | null>
  /**
   * Optional batch before-snapshot resolver used by `prepareMutation` when
   * `isBulk === true`. Returns one entry per record being touched; each entry
   * is diffed against the matching patch shape inside `toolCallArgs.records[]`.
   */
  loadBeforeRecords?: (
    input: TInput,
    context: McpToolContext,
  ) => Promise<AiToolLoadBeforeRecord[]>
  /** Optional per-turn call budget enforced by the focused-agent runtime. */
  maxCallsPerTurn?: number
  /** Declares the tool can receive resolved attachment parts at runtime. */
  supportsAttachments?: boolean
}

/**
 * Options for tool registration.
 */
export interface ToolRegistrationOptions {
  /** Module identifier (e.g., 'customers', 'sales') */
  moduleId?: string
}

/**
 * Tool registry interface for DI.
 */
export interface McpToolRegistry {
  registerTool<TInput, TOutput>(
    tool: McpToolDefinition<TInput, TOutput>,
    options?: ToolRegistrationOptions
  ): void

  getTools(): Map<string, McpToolDefinition>

  getTool(name: string): McpToolDefinition | undefined

  listToolNames(): string[]

  listToolsByModule(moduleId: string): string[]
}

/**
 * MCP server configuration.
 */
export interface McpServerConfig {
  /** Server name for MCP identification */
  name: string
  /** Server version */
  version: string
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Options for creating an MCP server.
 */
export interface McpServerOptions {
  config: McpServerConfig
  container: AwilixContainer
  /** Manual context (used when --tenant/--org/--user flags provided) */
  context?: {
    tenantId: string | null
    organizationId: string | null
    userId: string | null
  }
  /** API key secret for authentication (alternative to manual context) */
  apiKeySecret?: string
}

/**
 * Result from tool execution.
 */
export interface ToolExecutionResult {
  success: boolean
  result?: unknown
  error?: string
  errorCode?: 'NOT_FOUND' | 'UNAUTHORIZED' | 'VALIDATION_ERROR' | 'EXECUTION_ERROR'
}

// =============================================================================
// Client Types
// =============================================================================

/**
 * Tool information returned by listTools().
 */
export type ToolInfo = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/**
 * Result from callTool().
 */
export type ToolResult = {
  success: boolean
  result?: unknown
  error?: string
}

/**
 * Common interface for all MCP client modes.
 */
export interface McpClientInterface {
  /** List available tools (filtered by API key's permissions) */
  listTools(): Promise<ToolInfo[]>

  /** Execute a tool */
  callTool(name: string, args: unknown): Promise<ToolResult>

  /** Close the client and release resources */
  close(): Promise<void>
}

/**
 * HTTP session data for tracking authenticated sessions.
 */
export type McpHttpSession = {
  sessionId: string
  keyId: string
  tenantId: string | null
  organizationId: string | null
  userId: string
  features: string[]
  isSuperAdmin: boolean
  createdAt: Date
}
