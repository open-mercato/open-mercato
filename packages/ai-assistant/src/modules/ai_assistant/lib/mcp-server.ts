import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { getToolRegistry } from './tool-registry'
import { executeTool } from './tool-executor'
import { loadAllModuleTools } from './tool-loader'
import type { McpServerOptions, McpToolContext } from './types'

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
 * Create and configure an MCP server instance.
 */
export async function createMcpServer(options: McpServerOptions): Promise<Server> {
  const { config, container, context } = options

  // Load user ACL if userId provided
  let userFeatures: string[] = []
  let isSuperAdmin = false

  if (context.userId) {
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
      const acl = await rbacService.loadAcl(context.userId, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
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

  const toolContext: McpToolContext = {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    userId: context.userId,
    container,
    userFeatures,
    isSuperAdmin,
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
 */
export async function runMcpServer(options: McpServerOptions): Promise<void> {
  // Load tools from all modules before starting
  await loadAllModuleTools()

  const server = await createMcpServer(options)
  const transport = new StdioServerTransport()

  const toolCount = getToolRegistry().listToolNames().length

  console.error(`[MCP Server] Starting ${options.config.name} v${options.config.version}`)
  console.error(`[MCP Server] Tenant: ${options.context.tenantId ?? '(none)'}`)
  console.error(`[MCP Server] Organization: ${options.context.organizationId ?? '(none)'}`)
  console.error(`[MCP Server] User: ${options.context.userId ?? '(superadmin)'}`)
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
