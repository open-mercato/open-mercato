import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { getToolRegistry } from './tool-registry'
import { executeTool } from './tool-executor'
import { loadAllModuleTools } from './tool-loader'
import { authenticateMcpRequest, extractApiKeyFromHeaders } from './auth'
import type { McpServerConfig, McpToolContext } from './types'

/**
 * Options for the HTTP MCP server.
 */
export type McpHttpServerOptions = {
  config: McpServerConfig
  container: AwilixContainer
  port: number
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
 * Create a stateless MCP server instance for a single request.
 */
function createMcpServerForRequest(
  config: McpServerConfig,
  toolContext: McpToolContext
): McpServer {
  const server = new McpServer(
    { name: config.name, version: config.version },
    { capabilities: { tools: {} } }
  )

  const registry = getToolRegistry()
  const tools = Array.from(registry.getTools().values())

  // Filter tools based on user permissions
  const accessibleTools = tools.filter((tool) =>
    hasRequiredFeatures(tool.requiredFeatures, toolContext.userFeatures, toolContext.isSuperAdmin)
  )

  if (config.debug) {
    console.error(
      `[MCP HTTP] Registering ${accessibleTools.length}/${tools.length} tools (filtered by ACL)`
    )
  }

  // Register each tool with the McpServer using the new registerTool API
  for (const tool of accessibleTools) {
    // Pass Zod schema directly - MCP SDK handles conversion internally
    const inputSchema = tool.inputSchema as z.ZodType | undefined

    if (config.debug) {
      console.error(`[MCP HTTP] Registering tool: ${tool.name}`)
    }

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema,
      },
      async (args: Record<string, unknown>) => {
        if (config.debug) {
          console.error(`[MCP HTTP] Calling tool: ${tool.name}`, JSON.stringify(args))
        }

        const result = await executeTool(tool.name, args, toolContext)

        if (!result.success) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: result.error, code: result.errorCode }),
              },
            ],
            isError: true,
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result.result, null, 2),
            },
          ],
        }
      }
    )
  }

  return server
}

/**
 * Parse JSON body from request.
 */
async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8')
        resolve(body ? JSON.parse(body) : undefined)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Run MCP server with HTTP transport (stateless mode).
 *
 * Each request creates a new MCP server instance and transport.
 * The server authenticates requests using API keys from the x-api-key header.
 */
export async function runMcpHttpServer(options: McpHttpServerOptions): Promise<void> {
  const { config, container, port } = options

  await loadAllModuleTools()

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)

    // Health check endpoint
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'ok',
        tools: getToolRegistry().listToolNames().length,
        timestamp: new Date().toISOString(),
      }))
      return
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    // Extract headers
    const headers: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value[0] : value
    }

    // Authenticate request
    const apiKey = extractApiKeyFromHeaders(headers)
    if (!apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'API key required (x-api-key header)' }))
      return
    }

    const authResult = await authenticateMcpRequest(apiKey, container)
    if (!authResult.success) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: authResult.error }))
      return
    }

    if (config.debug) {
      console.error(`[MCP HTTP] Authenticated: ${authResult.keyName} (${req.method})`)
    }

    // Create tool context
    const toolContext: McpToolContext = {
      tenantId: authResult.tenantId,
      organizationId: authResult.organizationId,
      userId: authResult.userId,
      container,
      userFeatures: authResult.features,
      isSuperAdmin: authResult.isSuperAdmin,
    }

    try {
      // Create stateless transport (no session ID generator = stateless)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: req.method === 'POST',
      })

      // Create new server for this request
      const mcpServer = createMcpServerForRequest(config, toolContext)

      if (config.debug) {
        // Check registered tools on the server
        const registeredTools = (mcpServer as any)._registeredTools || {}
        console.error(`[MCP HTTP] Registered tools in McpServer:`, Object.keys(registeredTools))
        console.error(`[MCP HTTP] Tool handlers initialized:`, (mcpServer as any)._toolHandlersInitialized)
      }

      // Connect server to transport
      await mcpServer.connect(transport)

      // Handle the request
      if (req.method === 'POST') {
        const body = await parseJsonBody(req)
        await transport.handleRequest(req, res, body)
      } else {
        await transport.handleRequest(req, res)
      }

      // Cleanup after response finishes
      res.on('finish', () => {
        transport.close()
        mcpServer.close()
        if (config.debug) {
          console.error(`[MCP HTTP] Request completed, cleaned up`)
        }
      })
    } catch (error) {
      console.error('[MCP HTTP] Error handling request:', error)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: `Internal server error: ${error instanceof Error ? error.message : String(error)}`,
            },
            id: null,
          })
        )
      }
    }
  })

  const toolCount = getToolRegistry().listToolNames().length

  console.error(`[MCP HTTP] Starting ${config.name} v${config.version}`)
  console.error(`[MCP HTTP] Endpoint: http://localhost:${port}/mcp`)
  console.error(`[MCP HTTP] Health: http://localhost:${port}/health`)
  console.error(`[MCP HTTP] Tools registered: ${toolCount}`)
  console.error(`[MCP HTTP] Mode: Stateless (new server per request)`)
  console.error(`[MCP HTTP] Authentication: API key required (x-api-key header)`)

  // Return a Promise that keeps the process alive until shutdown
  return new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      console.error(`[MCP HTTP] Server listening on port ${port}`)
    })

    const shutdown = async () => {
      console.error('[MCP HTTP] Shutting down...')
      httpServer.close(() => {
        console.error('[MCP HTTP] Server closed')
        resolve()
      })
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
}
