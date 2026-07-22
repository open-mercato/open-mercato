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
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'


const formatStderrError = (error: unknown): string =>
  error instanceof Error ? error.stack ?? error.message : String(error)

const writeStderrLine = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

/**
 * Create and configure an MCP server instance.
 */
export async function createMcpServer(options: McpServerOptions): Promise<Server> {
  const { config, container, context, allowUnauthenticatedSuperadmin } = options

  // Treat empty / whitespace-only secrets as missing so a blank api key cannot
  // fall through into an unauthenticated branch.
  const apiKeySecret =
    typeof options.apiKeySecret === 'string' && options.apiKeySecret.trim().length > 0
      ? options.apiKeySecret
      : undefined

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
    writeStderrLine(`[MCP Server] Authenticated via API key: ${authResult.keyName}`)
  } else if (context && context.userId) {
    // Manual context with a real user — load that user's ACL.
    tenantId = context.tenantId
    organizationId = context.organizationId
    userId = context.userId

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
      writeStderrLine(`[MCP Server] Failed to load user ACL: ${formatStderrError(error)}`)
    }
  } else if (allowUnauthenticatedSuperadmin) {
    // Explicit, loud dev/testing opt-in. Without a user there is no ACL to load,
    // so the server runs as superadmin with no tenant scoping beyond whatever the
    // caller pinned via `context`. NEVER enable this in production.
    if (context) {
      tenantId = context.tenantId
      organizationId = context.organizationId
    }
    isSuperAdmin = true
    writeStderrLine(
      '[MCP Server] WARNING: allowUnauthenticatedSuperadmin is enabled — running with UNAUTHENTICATED SUPERADMIN access and no per-user ACL. Do not use this outside local development/testing.'
    )
  } else {
    // Fail closed: refuse to start rather than silently escalating to superadmin.
    throw new Error(
      '[internal] MCP server refused to start: no authentication provided. Supply a valid apiKeySecret, a context with a non-empty userId, or explicitly set allowUnauthenticatedSuperadmin: true for local development.'
    )
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
    const rbacService = container.resolve<RbacService>('rbacService')
    const accessibleTools = tools.filter((tool) =>
      hasRequiredFeatures(tool.requiredFeatures, userFeatures, isSuperAdmin, rbacService)
    )

    if (config.debug) {
      writeStderrLine(
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
      writeStderrLine(`[MCP Server] Calling tool: ${name} argKeys=${Object.keys(args ?? {}).join(',')}`)
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
  // Generate entity graph for Code Mode search tool
  try {
    const { extractEntityGraph, cacheEntityGraph } = await import('./entity-graph')
    const { getOrm } = await import('@open-mercato/shared/lib/db/mikro')
    const orm = await getOrm()
    const graph = await extractEntityGraph(orm)
    cacheEntityGraph(graph)
    writeStderrLine(`[MCP Server] Entity graph: ${graph.nodes.length} entities`)
  } catch (error) {
    writeStderrLine(`[MCP Server] Entity graph skipped: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Pre-cache raw OpenAPI spec for Code Mode search tool
  try {
    const { getRawOpenApiSpec } = await import('./api-endpoint-index')
    await getRawOpenApiSpec()
    writeStderrLine('[MCP Server] Raw OpenAPI spec cached for Code Mode')
  } catch (error) {
    writeStderrLine(`[MCP Server] Raw OpenAPI spec caching skipped: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Load tools from all modules before starting
  await loadAllModuleTools()

  // Index tools for hybrid search discovery (if search service available)
  try {
    const searchService = options.container.resolve('searchService') as SearchService
    await indexToolsForSearch(searchService)
  } catch (error) {
    // Search service might not be configured - discovery will use fallback
    writeStderrLine('[MCP Server] Search indexing skipped (search service not available)')
  }

  const server = await createMcpServer(options)
  const transport = new StdioServerTransport()

  const toolCount = getToolRegistry().listToolNames().length

  writeStderrLine(`[MCP Server] Starting ${options.config.name} v${options.config.version}`)

  if (options.apiKeySecret && options.apiKeySecret.trim().length > 0) {
    writeStderrLine(`[MCP Server] Authentication: API key`)
  } else if (options.context && options.context.userId) {
    writeStderrLine(`[MCP Server] Tenant: ${options.context.tenantId ?? '(none)'}`)
    writeStderrLine(`[MCP Server] Organization: ${options.context.organizationId ?? '(none)'}`)
    writeStderrLine(`[MCP Server] User: ${options.context.userId}`)
  } else {
    writeStderrLine(`[MCP Server] Authentication: none (unauthenticated superadmin opt-in)`)
  }

  writeStderrLine(`[MCP Server] Tools registered: ${toolCount}`)

  await server.connect(transport)

  writeStderrLine('[MCP Server] Connected and ready for requests')

  // Handle shutdown gracefully
  const shutdown = async () => {
    writeStderrLine('[MCP Server] Shutting down...')
    await server.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
