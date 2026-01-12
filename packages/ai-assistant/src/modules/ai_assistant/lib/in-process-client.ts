import type { AwilixContainer } from 'awilix'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { getToolRegistry } from './tool-registry'
import { executeTool } from './tool-executor'
import { loadAllModuleTools } from './tool-loader'
import { authenticateMcpRequest, type McpAuthSuccess } from './auth'
import type { McpToolContext, McpClientInterface, ToolInfo, ToolResult } from './types'

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
 * Check if user has required features for a tool.
 */
function hasRequiredFeatures(
  requiredFeatures: string[] | undefined,
  userFeatures: string[],
  isSuperAdmin: boolean
): boolean {
  if (isSuperAdmin) return true
  if (!requiredFeatures?.length) return true

  return requiredFeatures.every((required) => {
    if (userFeatures.includes(required)) return true
    if (userFeatures.includes('*')) return true

    return userFeatures.some((feature) => {
      if (feature.endsWith('.*')) {
        const prefix = feature.slice(0, -2)
        return required.startsWith(prefix + '.')
      }
      return false
    })
  })
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
   * Create and authenticate an in-process client.
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
   */
  async listTools(): Promise<ToolInfo[]> {
    await this.ensureToolsLoaded()

    const registry = getToolRegistry()
    const tools = Array.from(registry.getTools().values())

    const accessibleTools = tools.filter((tool) =>
      hasRequiredFeatures(tool.requiredFeatures, this.auth.features, this.auth.isSuperAdmin)
    )

    return accessibleTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema as any) as Record<string, unknown>,
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
