import type { AwilixContainer } from 'awilix'
import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { getToolRegistry } from './tool-registry'
import { executeTool } from './tool-executor'
import { loadAllModuleTools } from './tool-loader'
import { authenticateMcpRequest, hasRequiredFeatures, type McpAuthSuccess } from './auth'
import type { McpToolContext, McpClientInterface, ToolInfo, ToolResult, McpToolDefinition } from './types'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

/**
 * Options for creating an in-process MCP client.
 */
export type InProcessClientOptions = {
  /** API key secret for authentication */
  apiKeySecret: string
  /** DI container */
  container: AwilixContainer
}

/**
 * Options for creating an in-process MCP client with direct auth context.
 * Used when the caller already has authenticated user context (e.g., from session).
 */
export type AuthContextOptions = {
  /** DI container */
  container: AwilixContainer
  /** Pre-authenticated user context */
  authContext: {
    tenantId: string | null
    organizationId: string | null
    userId: string
    userFeatures: string[]
    isSuperAdmin: boolean
  }
}

/**
 * Tool info with raw Zod schema for AI SDK integration.
 */
export type ToolInfoWithSchema = {
  name: string
  description: string
  inputSchema: z.ZodType<unknown>
}

/**
 * In-process MCP client for direct tool execution.
 *
 * This client executes tools directly without MCP protocol overhead,
 * making it the fastest option when running in the same process as
 * the LLM service.
 *
 * Authentication is still performed via API key to ensure proper
 * ACL filtering of available tools.
 */
export class InProcessMcpClient implements McpClientInterface {
  private auth: McpAuthSuccess
  private container: AwilixContainer
  private toolContext: McpToolContext
  private toolsLoaded = false

  private constructor(auth: McpAuthSuccess, container: AwilixContainer) {
    this.auth = auth
    this.container = container
    this.toolContext = {
      tenantId: auth.tenantId,
      organizationId: auth.organizationId,
      userId: auth.userId,
      container,
      userFeatures: auth.features,
      isSuperAdmin: auth.isSuperAdmin,
    }
  }

  /**
   * Create and authenticate an in-process client using API key.
   */
  static async create(options: InProcessClientOptions): Promise<InProcessMcpClient> {
    const { apiKeySecret, container } = options

    const authResult = await authenticateMcpRequest(apiKeySecret, container)
    if (!authResult.success) {
      throw new Error(`Authentication failed: ${authResult.error}`)
    }

    return new InProcessMcpClient(authResult, container)
  }

  /**
   * Create an in-process client with pre-authenticated context.
   * Use this when you already have user auth context (e.g., from session auth).
   */
  static async createWithAuthContext(options: AuthContextOptions): Promise<InProcessMcpClient> {
    const { container, authContext } = options

    // Create a synthetic auth result (no API key lookup needed)
    const syntheticAuth: McpAuthSuccess = {
      success: true,
      keyId: 'session-auth',
      keyName: 'Session Authentication',
      tenantId: authContext.tenantId,
      organizationId: authContext.organizationId,
      userId: authContext.userId,
      features: authContext.userFeatures,
      isSuperAdmin: authContext.isSuperAdmin,
    }

    return new InProcessMcpClient(syntheticAuth, container)
  }

  /**
   * Ensure tools are loaded from all modules.
   */
  private async ensureToolsLoaded(): Promise<void> {
    if (!this.toolsLoaded) {
      await loadAllModuleTools()
      this.toolsLoaded = true
    }
  }

  /**
   * List available tools filtered by API key's permissions.
   * Returns JSON Schema format (for MCP protocol compatibility).
   */
  async listTools(): Promise<ToolInfo[]> {
    await this.ensureToolsLoaded()

    const registry = getToolRegistry()
    const tools = Array.from(registry.getTools().values())

    const rbacService = this.container.resolve<RbacService>('rbacService')
    const accessibleTools = tools.filter((tool) =>
      hasRequiredFeatures(tool.requiredFeatures, this.auth.features, this.auth.isSuperAdmin, rbacService)
    )

    return accessibleTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema as any) as Record<string, unknown>,
    }))
  }

  /**
   * List available tools with raw Zod schemas.
   * Use this for AI SDK integration which requires Zod schemas.
   */
  async listToolsWithSchemas(): Promise<ToolInfoWithSchema[]> {
    await this.ensureToolsLoaded()

    const registry = getToolRegistry()
    const tools = Array.from(registry.getTools().values())

    const rbacService = this.container.resolve<RbacService>('rbacService')
    const accessibleTools = tools.filter((tool) =>
      hasRequiredFeatures(tool.requiredFeatures, this.auth.features, this.auth.isSuperAdmin, rbacService)
    )

    return accessibleTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))
  }

  /**
   * Execute a tool directly.
   */
  async callTool(name: string, args: unknown): Promise<ToolResult> {
    await this.ensureToolsLoaded()

    const result = await executeTool(name, args ?? {}, this.toolContext)

    return {
      success: result.success,
      result: result.result,
      error: result.error,
    }
  }

  /**
   * Close the client (no-op for in-process).
   */
  async close(): Promise<void> {
    // No resources to clean up for in-process client
  }

  /**
   * Get the authenticated context info.
   */
  getAuthInfo(): {
    keyId: string
    keyName: string
    tenantId: string | null
    organizationId: string | null
    userId: string
    isSuperAdmin: boolean
  } {
    return {
      keyId: this.auth.keyId,
      keyName: this.auth.keyName,
      tenantId: this.auth.tenantId,
      organizationId: this.auth.organizationId,
      userId: this.auth.userId,
      isSuperAdmin: this.auth.isSuperAdmin,
    }
  }
}
