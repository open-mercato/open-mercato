import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { getToolRegistry } from './tool-registry'
import { executeTool } from './tool-executor'
import { loadAllModuleTools, indexToolsForSearch } from './tool-loader'
import { authenticateMcpRequest, hasRequiredFeatures } from './auth'
import type { McpServerOptions, McpToolContext } from './types'
import type { SearchService } from '@open-mercato/search/service'

/**
 * Create and configure an MCP server instance.
 */
export async function createMcpServer(options: McpServerOptions): Promise<Server> {
  const { config, container, context, apiKeySecret } = options

  let tenantId: string | null = null
  let organizationId: string | null = null
  let userId: string | null = null
  let userFeatures: string[] = []
  let isSuperAdmin = false

  // API key authentication takes precedence
  if (apiKeySecret) {
    const authResult = await authenticateMcpRequest(apiKeySecret, container)
    if (!authResult.success) {
      throw new Error(`API key authentication failed: ${authResult.error}`)
    }
    tenantId = authResult.tenantId
    organizationId = authResult.organizationId
    userId = authResult.userId
    userFeatures = authResult.features
    isSuperAdmin = authResult.isSuperAdmin
    console.error(`[MCP Server] Authenticated via API key: ${authResult.keyName}`)
  } else if (context) {
    // Manual context provided
    tenantId = context.tenantId
    organizationId = context.organizationId
    userId = context.userId

    if (userId) {
      try {
        const rbacService = container.resolve('rbacService') as {
          loadAcl: (
            userId: string,
            scope: { tenantId: string | null; organizationId: string | null }
          ) => Promise<{
            isSuperAdmin: boolean
            features: string[]
          }>
        }
        const acl = await rbacService.loadAcl(userId, {
          tenantId,
          organizationId,
        })
        userFeatures = acl.features
        isSuperAdmin = acl.isSuperAdmin
      } catch (error) {
        console.error('[MCP Server] Failed to load user ACL:', error)
      }
    } else {
      // No user specified - grant superadmin access for development/testing
      isSuperAdmin = true
      console.error('[MCP Server] No user specified, running with superadmin access')
    }
  } else {
    // No context and no API key - superadmin for dev/testing
    isSuperAdmin = true
    console.error('[MCP Server] No auth context, running with superadmin access')
  }

  const toolContext: McpToolContext = {
    tenantId,
    organizationId,
    userId,
    container,
    userFeatures,
    isSuperAdmin,
    apiKeySecret,
  }

  const server = new Server(
    { name: config.name, version: config.version },
    { capabilities: { tools: {} } }
  )

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const registry = getToolRegistry()
    const tools = Array.from(registry.getTools().values())

    // Filter tools based on user permissions
    const accessibleTools = tools.filter((tool) =>
      hasRequiredFeatures(tool.requiredFeatures, userFeatures, isSuperAdmin)
    )

    if (config.debug) {
      console.error(
        `[MCP Server] Listing ${accessibleTools.length}/${tools.length} tools (filtered by ACL)`
      )
    }

    return {
      tools: accessibleTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        // Cast to any for Zod v4 compatibility with zod-to-json-schema
        inputSchema: zodToJsonSchema(tool.inputSchema as any) as Record<string, unknown>,
      })),
    }
  })

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    if (config.debug) {
      console.error(`[MCP Server] Calling tool: ${name}`, JSON.stringify(args))
    }

    const result = await executeTool(name, args ?? {}, toolContext)

    if (!result.success) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: result.error, code: result.errorCode }),
          },
        ],
        isError: true,
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result.result, null, 2),
        },
      ],
    }
  })

  return server
}

/**
 * Run MCP server with stdio transport.
 * This keeps the process running until terminated.
 *
 * Supports two authentication modes:
 * 1. API key: Provide `apiKeySecret` option
 * 2. Manual context: Provide `context` with tenant/org/user
 */
export async function runMcpServer(options: McpServerOptions): Promise<void> {
  // Load tools from all modules before starting
  await loadAllModuleTools()

  // Index tools and API endpoints for hybrid search discovery (if search service available)
  try {
    const searchService = options.container.resolve('searchService') as SearchService

    // Index MCP tools
    await indexToolsForSearch(searchService)

    // Index API endpoints for api_discover
    const { indexApiEndpoints } = await import('./api-endpoint-index')
    const endpointCount = await indexApiEndpoints(searchService)
    if (endpointCount > 0) {
      console.error(`[MCP Server] Indexed ${endpointCount} API endpoints for hybrid search`)
    }
  } catch (error) {
    // Search service might not be configured - discovery will use fallback
    console.error('[MCP Server] Search indexing skipped (search service not available)')
  }

  const server = await createMcpServer(options)
  const transport = new StdioServerTransport()

  const toolCount = getToolRegistry().listToolNames().length

  console.error(`[MCP Server] Starting ${options.config.name} v${options.config.version}`)

  if (options.apiKeySecret) {
    console.error(`[MCP Server] Authentication: API key`)
  } else if (options.context) {
    console.error(`[MCP Server] Tenant: ${options.context.tenantId ?? '(none)'}`)
    console.error(`[MCP Server] Organization: ${options.context.organizationId ?? '(none)'}`)
    console.error(`[MCP Server] User: ${options.context.userId ?? '(superadmin)'}`)
  } else {
    console.error(`[MCP Server] Authentication: none (superadmin mode)`)
  }

  console.error(`[MCP Server] Tools registered: ${toolCount}`)

  await server.connect(transport)

  console.error('[MCP Server] Connected and ready for requests')

  // Handle shutdown gracefully
  const shutdown = async () => {
    console.error('[MCP Server] Shutting down...')
    await server.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
