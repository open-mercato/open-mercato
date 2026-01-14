import type { AwilixContainer } from 'awilix'
import type { z } from 'zod'
import type { McpClientInterface, ToolInfo, ToolResult } from './types'
import { InProcessMcpClient, type AuthContextOptions, type ToolInfoWithSchema } from './in-process-client'
import { createMcpClient } from './client-factory'
import { getEnabledMcpServerConfigs, type McpServerConfig } from './mcp-server-config'

/**
 * Auth context for creating the local client.
 */
export interface AuthContext {
  tenantId: string | null
  organizationId: string | null
  userId: string
  userFeatures: string[]
  isSuperAdmin: boolean
}

/**
 * Options for creating the connection manager.
 */
export interface McpConnectionManagerOptions {
  /** DI container */
  container: AwilixContainer
  /** Pre-authenticated user context */
  authContext: AuthContext
  /** Whether to connect to external servers (default: true) */
  enableExternalServers?: boolean
}

/**
 * Extended tool info that includes source server information.
 */
export interface ExtendedToolInfo extends ToolInfo {
  /** The server this tool came from */
  serverId: string
  /** Whether this is from the local server */
  isLocal: boolean
}

/**
 * Extended tool info with Zod schema.
 */
export interface ExtendedToolInfoWithSchema extends ToolInfoWithSchema {
  /** The server this tool came from */
  serverId: string
  /** Whether this is from the local server */
  isLocal: boolean
}

/**
 * Manages connections to multiple MCP servers.
 *
 * Provides a unified interface for:
 * - Local in-process MCP tools (built-in)
 * - External MCP servers (HTTP/stdio)
 *
 * Tools are aggregated from all connected servers and routed
 * to the correct server when called.
 */
export class McpConnectionManager implements McpClientInterface {
  private localClient: InProcessMcpClient | null = null
  private externalClients: Map<string, McpClientInterface> = new Map()
  private toolServerMap: Map<string, string> = new Map() // tool name -> server id
  private connected = false

  private constructor(
    private container: AwilixContainer,
    private authContext: AuthContext,
    private enableExternalServers: boolean
  ) {}

  /**
   * Create and connect a connection manager.
   */
  static async create(options: McpConnectionManagerOptions): Promise<McpConnectionManager> {
    const manager = new McpConnectionManager(
      options.container,
      options.authContext,
      options.enableExternalServers ?? true
    )
    await manager.connect()
    return manager
  }

  /**
   * Connect to all MCP servers.
   */
  private async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    // 1. Create local in-process client
    this.localClient = await InProcessMcpClient.createWithAuthContext({
      container: this.container,
      authContext: this.authContext,
    })

    // 2. Connect to enabled external servers
    if (this.enableExternalServers) {
      const configs = await getEnabledMcpServerConfigs({ resolve: (name) => this.container.resolve(name) })

      for (const config of configs) {
        try {
          const client = await this.createExternalClient(config)
          if (client) {
            this.externalClients.set(config.id, client)
          }
        } catch (error) {
          console.error(`[MCP] Failed to connect to server ${config.name}:`, error)
          // Continue with other servers
        }
      }
    }

    // 3. Build tool -> server mapping
    await this.buildToolServerMap()

    this.connected = true
  }

  /**
   * Create a client for an external MCP server.
   */
  private async createExternalClient(config: McpServerConfig): Promise<McpClientInterface | null> {
    // For external servers, we need an API key
    // In a real implementation, we would retrieve the API key from secure storage
    // For now, we skip servers that require authentication
    if (!config.apiKeyId) {
      console.warn(`[MCP] Skipping server ${config.name}: No API key configured`)
      return null
    }

    // TODO: Retrieve actual API key secret from secure storage using config.apiKeyId
    // For now, this is a placeholder
    const apiKeySecret = await this.resolveApiKeySecret(config.apiKeyId)
    if (!apiKeySecret) {
      console.warn(`[MCP] Skipping server ${config.name}: Could not resolve API key`)
      return null
    }

    if (config.type === 'http') {
      if (!config.url) {
        console.warn(`[MCP] Skipping server ${config.name}: No URL configured`)
        return null
      }

      return createMcpClient({
        mode: 'http',
        apiKeySecret,
        httpUrl: config.url,
      })
    }

    if (config.type === 'stdio') {
      if (!config.command) {
        console.warn(`[MCP] Skipping server ${config.name}: No command configured`)
        return null
      }

      return createMcpClient({
        mode: 'stdio',
        apiKeySecret,
        stdioCommand: config.command,
        stdioArgs: config.args,
      })
    }

    return null
  }

  /**
   * Resolve an API key secret from its ID.
   * TODO: Implement actual secure storage lookup.
   */
  private async resolveApiKeySecret(_apiKeyId: string): Promise<string | null> {
    // Placeholder: In production, this would look up the API key from secure storage
    // For now, we return null to skip external servers that need API keys
    return null
  }

  /**
   * Build a mapping from tool names to their source servers.
   */
  private async buildToolServerMap(): Promise<void> {
    this.toolServerMap.clear()

    // Map local tools
    if (this.localClient) {
      const localTools = await this.localClient.listTools()
      for (const tool of localTools) {
        this.toolServerMap.set(tool.name, 'local')
      }
    }

    // Map external tools (may override local if names conflict)
    for (const [serverId, client] of this.externalClients) {
      try {
        const tools = await client.listTools()
        for (const tool of tools) {
          // Prefix external tool names to avoid conflicts
          // Or use first-come-first-served (current implementation)
          if (!this.toolServerMap.has(tool.name)) {
            this.toolServerMap.set(tool.name, serverId)
          }
        }
      } catch (error) {
        console.error(`[MCP] Failed to list tools from server ${serverId}:`, error)
      }
    }
  }

  /**
   * List tools from all connected servers (JSON Schema format).
   */
  async listTools(): Promise<ToolInfo[]> {
    const allTools: ToolInfo[] = []

    // Get local tools
    if (this.localClient) {
      const localTools = await this.localClient.listTools()
      allTools.push(...localTools)
    }

    // Get external tools
    for (const [, client] of this.externalClients) {
      try {
        const tools = await client.listTools()
        // Only add tools that aren't already in the list
        for (const tool of tools) {
          if (!allTools.some((t) => t.name === tool.name)) {
            allTools.push(tool)
          }
        }
      } catch (error) {
        // Skip failed servers
      }
    }

    return allTools
  }

  /**
   * List tools from all connected servers with Zod schemas.
   * For external servers, this returns JSON Schema since we can't get Zod schemas.
   */
  async listToolsWithSchemas(): Promise<ExtendedToolInfoWithSchema[]> {
    const allTools: ExtendedToolInfoWithSchema[] = []

    // Get local tools with schemas
    if (this.localClient) {
      const localTools = await this.localClient.listToolsWithSchemas()
      for (const tool of localTools) {
        allTools.push({
          ...tool,
          serverId: 'local',
          isLocal: true,
        })
      }
    }

    // For external servers, we only have JSON Schema, not Zod schemas
    // This is a limitation - external tools can only be used with manual validation
    // For now, skip external tools in listToolsWithSchemas

    return allTools
  }

  /**
   * List all tools with extended info.
   */
  async listExtendedTools(): Promise<ExtendedToolInfo[]> {
    const allTools: ExtendedToolInfo[] = []

    // Get local tools
    if (this.localClient) {
      const localTools = await this.localClient.listTools()
      for (const tool of localTools) {
        allTools.push({
          ...tool,
          serverId: 'local',
          isLocal: true,
        })
      }
    }

    // Get external tools
    for (const [serverId, client] of this.externalClients) {
      try {
        const tools = await client.listTools()
        for (const tool of tools) {
          if (!allTools.some((t) => t.name === tool.name)) {
            allTools.push({
              ...tool,
              serverId,
              isLocal: false,
            })
          }
        }
      } catch (error) {
        // Skip failed servers
      }
    }

    return allTools
  }

  /**
   * Call a tool, routing to the correct server.
   */
  async callTool(name: string, args: unknown): Promise<ToolResult> {
    const serverId = this.toolServerMap.get(name)

    if (!serverId) {
      return {
        success: false,
        error: `Tool not found: ${name}`,
      }
    }

    if (serverId === 'local') {
      if (!this.localClient) {
        return {
          success: false,
          error: 'Local client not connected',
        }
      }
      return this.localClient.callTool(name, args)
    }

    const client = this.externalClients.get(serverId)
    if (!client) {
      return {
        success: false,
        error: `Server not connected: ${serverId}`,
      }
    }

    return client.callTool(name, args)
  }

  /**
   * Close all connections.
   */
  async close(): Promise<void> {
    await this.localClient?.close()

    for (const client of this.externalClients.values()) {
      try {
        await client.close()
      } catch (error) {
        // Ignore close errors
      }
    }

    this.localClient = null
    this.externalClients.clear()
    this.toolServerMap.clear()
    this.connected = false
  }

  /**
   * Get connection status.
   */
  getStatus(): {
    connected: boolean
    localConnected: boolean
    externalServers: { id: string; connected: boolean }[]
  } {
    return {
      connected: this.connected,
      localConnected: this.localClient !== null,
      externalServers: Array.from(this.externalClients.keys()).map((id) => ({
        id,
        connected: true,
      })),
    }
  }
}
