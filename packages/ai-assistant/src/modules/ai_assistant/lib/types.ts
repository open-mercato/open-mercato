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
