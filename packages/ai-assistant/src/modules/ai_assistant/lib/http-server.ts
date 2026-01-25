import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z, type ZodType } from 'zod'
import { getToolRegistry } from './tool-registry'
import { executeTool } from './tool-executor'
import { loadAllModuleTools, indexToolsForSearch } from './tool-loader'
import { authenticateMcpRequest, extractApiKeyFromHeaders, hasRequiredFeatures } from './auth'
import { jsonSchemaToZod, toSafeZodSchema } from './schema-utils'
import type { McpServerConfig, McpToolContext } from './types'
import type { SearchService } from '@open-mercato/search/service'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { findSessionApiKeyWithSecret } from '@open-mercato/core/modules/api_keys/services/apiKeyService'

/**
 * Options for the HTTP MCP server.
 */
export type McpHttpServerOptions = {
  config: McpServerConfig
  container: AwilixContainer
  port: number
  /** Static API key for server-level authentication (from env MCP_SERVER_API_KEY) */
  serverApiKey?: string
}

/**
 * Resolve user context from session token.
 * Returns null if session token is invalid or expired.
 * Includes the decrypted API key secret for making authenticated API calls.
 */
async function resolveSessionContext(
  sessionToken: string,
  baseContext: McpToolContext,
  debug?: boolean
): Promise<McpToolContext | null> {
  try {
    const em = baseContext.container.resolve<EntityManager>('em')
    const rbacService = baseContext.container.resolve<RbacService>('rbacService')

    // Look up ephemeral key by session token with decrypted secret
    const sessionResult = await findSessionApiKeyWithSecret(em, sessionToken)
    if (!sessionResult) {
      if (debug) {
        console.error(`[MCP HTTP] Session token not found, expired, or secret unavailable: ${sessionToken}`)
      }
      return null
    }

    const { key: sessionKey, secret: sessionSecret } = sessionResult

    // Load ACL for the session user
    const userId = sessionKey.sessionUserId || sessionKey.createdBy
    if (!userId) {
      if (debug) {
        console.error(`[MCP HTTP] Session key has no associated user`)
      }
      return null
    }

    const acl = await rbacService.loadAcl(`api_key:${sessionKey.id}`, {
      tenantId: sessionKey.tenantId ?? null,
      organizationId: sessionKey.organizationId ?? null,
    })

    if (debug) {
      console.error(`[MCP HTTP] Session context resolved for user ${userId}:`, {
        tenantId: sessionKey.tenantId,
        organizationId: sessionKey.organizationId,
        features: acl.features.length,
        isSuperAdmin: acl.isSuperAdmin,
        hasSessionSecret: !!sessionSecret,
      })
    }

    return {
      tenantId: sessionKey.tenantId ?? null,
      organizationId: sessionKey.organizationId ?? null,
      userId,
      container: baseContext.container,
      userFeatures: acl.features,
      isSuperAdmin: acl.isSuperAdmin,
      // Use the decrypted session secret for API calls (not the MCP server key)
      apiKeySecret: sessionSecret,
    }
  } catch (error) {
    if (debug) {
      console.error(`[MCP HTTP] Error resolving session context:`, error)
    }
    return null
  }
}

/**
 * Create a stateless MCP server instance for a single request.
 * Tools are registered without pre-filtering - permission checks happen at execution time
 * based on the session token provided in each tool call.
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

  if (config.debug) {
    console.error(`[MCP HTTP] Registering ${tools.length} tools (ACL checked per-call via session token)`)
  }

  // Register ALL tools - permission checks happen at execution time via session token
  for (const tool of tools) {
    if (config.debug) {
      console.error(`[MCP HTTP] Registering tool: ${tool.name}`)
    }

    // Convert Zod schema to a "safe" schema without Date types
    // This uses JSON Schema round-trip to avoid issues with MCP SDK's internal conversion
    // Also inject _sessionToken as an optional parameter so the AI knows to pass it
    let safeSchema: ZodType | undefined
    if (tool.inputSchema) {
      try {
        // Convert to JSON Schema first
        const jsonSchema = z.toJSONSchema(tool.inputSchema, { unrepresentable: 'any' }) as Record<string, unknown>

        // Inject _sessionToken into the JSON schema properties
        const properties = (jsonSchema.properties ?? {}) as Record<string, unknown>
        properties._sessionToken = {
          type: 'string',
          description: 'Session authorization token (REQUIRED for all tool calls)',
        }
        jsonSchema.properties = properties

        // Convert back to Zod with passthrough to allow extra properties
        const converted = jsonSchemaToZod(jsonSchema)
        // Use type assertion since we know it's an object schema (we added properties above)
        safeSchema = (converted as z.ZodObject<any>).passthrough()
      } catch (error) {
        if (config.debug) {
          console.error(
            `[MCP HTTP] Skipping tool ${tool.name} - schema conversion failed:`,
            error instanceof Error ? error.message : error
          )
        }
        continue
      }
    } else {
      // If no schema, create one with just _sessionToken
      safeSchema = z.object({
        _sessionToken: z
          .string()
          .optional()
          .describe('Session authorization token (REQUIRED for all tool calls)'),
      })
    }

    // Wrap in try/catch to handle any remaining edge cases
    try {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: safeSchema,
        },
        async (args: unknown) => {
          const toolArgs = (args ?? {}) as Record<string, unknown>

          // Extract session token from args
          const sessionToken = toolArgs._sessionToken as string | undefined
          delete toolArgs._sessionToken // Remove before passing to tool handler

          // Always log tool calls for debugging
          console.error(`[MCP HTTP] ▶ Tool call: ${tool.name}`, {
            hasSessionToken: !!sessionToken,
            args: JSON.stringify(toolArgs).slice(0, 200),
          })

          // Resolve user context from session token
          let effectiveContext = toolContext
          if (sessionToken) {
            const sessionContext = await resolveSessionContext(sessionToken, toolContext, config.debug)
            if (sessionContext) {
              // Session context includes the decrypted API key secret
              effectiveContext = sessionContext
            } else {
              // Session token expired - return user-friendly error for AI to relay
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      error: 'Your chat session has expired. Please close and reopen the chat window to continue.',
                      code: 'SESSION_EXPIRED',
                    }),
                  },
                ],
                isError: true,
              }
            }
          } else {
            // No session token provided - reject if base context has no permissions
            if (!effectiveContext.userId && effectiveContext.userFeatures.length === 0) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      error: 'Session token required (_sessionToken parameter)',
                      code: 'UNAUTHORIZED',
                    }),
                  },
                ],
                isError: true,
              }
            }
          }

          // Check if user has required permissions for this tool
          if (tool.requiredFeatures?.length) {
            const hasAccess = hasRequiredFeatures(
              tool.requiredFeatures,
              effectiveContext.userFeatures,
              effectiveContext.isSuperAdmin
            )
            if (!hasAccess) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      error: `Insufficient permissions for tool "${tool.name}". Required: ${tool.requiredFeatures.join(', ')}`,
                      code: 'UNAUTHORIZED',
                    }),
                  },
                ],
                isError: true,
              }
            }
          }

          try {
            const result = await executeTool(tool.name, toolArgs, effectiveContext)

            if (!result.success) {
              console.error(`[MCP HTTP] ✗ Tool error: ${tool.name}`, { error: result.error, code: result.errorCode })
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

            console.error(`[MCP HTTP] ✓ Tool success: ${tool.name}`, {
              resultPreview: JSON.stringify(result.result).slice(0, 200)
            })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(result.result, null, 2),
                },
              ],
            }
          } catch (err) {
            console.error(`[MCP HTTP] ✗ Tool exception: ${tool.name}`, err)
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error', code: 'EXCEPTION' }),
                },
              ],
              isError: true,
            }
          }
        }
      )
    } catch (error) {
      // Skip tools with schemas that can't be registered
      if (config.debug) {
        console.error(
          `[MCP HTTP] Skipping tool ${tool.name} - registration failed:`,
          error instanceof Error ? error.message : error
        )
      }
      continue
    }
  }

  return server
}

/**
 * Maximum request body size (1MB).
 * Prevents memory exhaustion from oversized payloads.
 */
const MAX_BODY_SIZE = 1 * 1024 * 1024

/**
 * Parse JSON body from request with size limit.
 */
async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalSize = 0

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy()
        reject(new Error('Request payload too large'))
        return
      }
      chunks.push(chunk)
    })
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

  // Generate and cache entity graph for understand_entity tool
  try {
    const { extractEntityGraph, cacheEntityGraph } = await import('./entity-graph')
    const { getOrm } = await import('@open-mercato/shared/lib/db/mikro')

    const orm = await getOrm()
    const graph = await extractEntityGraph(orm)
    cacheEntityGraph(graph)
    console.error(`[MCP HTTP] Entity graph: ${graph.nodes.length} entities, ${graph.edges.length} relationships`)
  } catch (error) {
    console.error('[MCP HTTP] Entity graph generation skipped:', error instanceof Error ? error.message : error)
  }

  // Index tools, API endpoints, and entity schemas for hybrid search discovery (if search service available)
  try {
    const searchService = container.resolve('searchService') as SearchService

    // Index MCP tools
    await indexToolsForSearch(searchService)

    // Index API endpoints for find_api
    const { indexApiEndpoints } = await import('./api-endpoint-index')
    const endpointCount = await indexApiEndpoints(searchService)
    if (endpointCount > 0) {
      console.error(`[MCP HTTP] Indexed ${endpointCount} API endpoints for hybrid search`)
    }

    // Index entity schemas for discover_schema
    try {
      const { getCachedEntityGraph } = await import('./entity-graph')
      const { indexEntitiesForSearch } = await import('./entity-index')
      const graph = getCachedEntityGraph()
      if (graph) {
        const { count } = await indexEntitiesForSearch(searchService, graph)
        if (count > 0) {
          console.error(`[MCP HTTP] Indexed ${count} entity schemas for hybrid search`)
        }
      }
    } catch (entityError) {
      console.error('[MCP HTTP] Entity schema indexing skipped:', entityError instanceof Error ? entityError.message : entityError)
    }
  } catch (error) {
    // Search service might not be configured - discovery will use fallback
    console.error('[MCP HTTP] Search indexing skipped (search service not available):', error)
  }

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

    console.error(`[MCP HTTP] ← Request: ${req.method} ${url.pathname}`)

    // Extract headers
    const headers: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value[0] : value
    }

    // Server-level authentication with static API key
    const providedApiKey = extractApiKeyFromHeaders(headers)
    if (!providedApiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'API key required (x-api-key header)' }))
      return
    }

    // Check against static server API key (from env MCP_SERVER_API_KEY)
    const serverApiKey = options.serverApiKey || process.env.MCP_SERVER_API_KEY
    if (!serverApiKey) {
      console.error('[MCP HTTP] Warning: MCP_SERVER_API_KEY not configured, rejecting all requests')
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'MCP server not properly configured' }))
      return
    }

    if (providedApiKey !== serverApiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid API key' }))
      return
    }

    if (config.debug) {
      console.error(`[MCP HTTP] Server-level auth passed (${req.method})`)
    }

    // Create base tool context (will be overridden by session token per-tool)
    // Start with minimal permissions - session tokens provide user-level auth
    const toolContext: McpToolContext = {
      tenantId: null,
      organizationId: null,
      userId: null,
      container,
      userFeatures: [],
      isSuperAdmin: false,
      apiKeySecret: providedApiKey,
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
        // Handle payload too large error
        if (error instanceof Error && error.message === 'Request payload too large') {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Request payload too large (max 1MB)' }))
          return
        }

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
  const serverKeyConfigured = !!(options.serverApiKey || process.env.MCP_SERVER_API_KEY)

  console.error(`[MCP HTTP] Starting ${config.name} v${config.version}`)
  console.error(`[MCP HTTP] Endpoint: http://localhost:${port}/mcp`)
  console.error(`[MCP HTTP] Health: http://localhost:${port}/health`)
  console.error(`[MCP HTTP] Tools registered: ${toolCount}`)
  console.error(`[MCP HTTP] Mode: Stateless (new server per request)`)
  console.error(`[MCP HTTP] Server Auth: ${serverKeyConfigured ? 'MCP_SERVER_API_KEY configured' : 'WARNING: MCP_SERVER_API_KEY not set!'}`)
  console.error(`[MCP HTTP] User Auth: Session token in _sessionToken parameter`)

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
