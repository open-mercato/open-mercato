import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z, type ZodType } from 'zod'
import { getToolRegistry } from './tool-registry'
import { executeTool } from './tool-executor'
import { loadAllModuleTools, indexToolsForSearch } from './tool-loader'
import { authenticateMcpRequest, extractApiKeyFromHeaders, hasRequiredFeatures } from './auth'
import { jsonSchemaToZod } from './schema-utils'
import type { McpToolContext } from './types'
import type { SearchService } from '@open-mercato/search/service'

const DEFAULT_PORT = 3001

const log = (message: string, ...args: unknown[]) => {
  console.error(`[MCP Dev] ${message}`, ...args)
}

async function getApiKeyFromMcpJson(): Promise<string | undefined> {
  const { readFile } = await import('node:fs/promises')
  const { resolve } = await import('node:path')

  try {
    const mcpJsonPath = resolve(process.cwd(), '.mcp.json')
    const content = await readFile(mcpJsonPath, 'utf-8')
    const config = JSON.parse(content)
    const serverConfig = config?.mcpServers?.['open-mercato']

    // Check env.OPEN_MERCATO_API_KEY first, then headers.x-api-key (HTTP style)
    return serverConfig?.env?.OPEN_MERCATO_API_KEY ?? serverConfig?.headers?.['x-api-key']
  } catch {
    return undefined
  }
}

/**
 * Maximum request body size (1MB).
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
 * Create MCP server with tools pre-authenticated for dev use.
 * No session tokens required - uses API key authentication directly.
 */
function createDevMcpServer(
  toolContext: McpToolContext,
  authFeatures: string[],
  isSuperAdmin: boolean,
  debug: boolean
): McpServer {
  const server = new McpServer(
    { name: 'open-mercato-mcp-dev', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  const registry = getToolRegistry()
  const tools = Array.from(registry.getTools().values())

  // Filter tools based on API key permissions
  const accessibleTools = tools.filter((tool) =>
    hasRequiredFeatures(tool.requiredFeatures, authFeatures, isSuperAdmin)
  )

  if (debug) {
    log(`Registering ${accessibleTools.length}/${tools.length} tools (filtered by API key permissions)`)
  }

  for (const tool of accessibleTools) {
    if (debug) {
      log(`Registering tool: ${tool.name}`)
    }

    // Convert Zod schema to safe schema without Date types
    let safeSchema: ZodType | undefined
    if (tool.inputSchema) {
      try {
        const jsonSchema = z.toJSONSchema(tool.inputSchema, { unrepresentable: 'any' }) as Record<string, unknown>
        const converted = jsonSchemaToZod(jsonSchema)
        safeSchema = (converted as z.ZodObject<any>).passthrough()
      } catch (error) {
        if (debug) {
          log(`Skipping tool ${tool.name} - schema conversion failed:`, error instanceof Error ? error.message : error)
        }
        continue
      }
    } else {
      safeSchema = z.object({}).passthrough()
    }

    try {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: safeSchema,
        },
        async (args: unknown) => {
          const toolArgs = (args ?? {}) as Record<string, unknown>

          if (debug) {
            log(`Calling tool: ${tool.name}`, JSON.stringify(toolArgs))
          }

          const result = await executeTool(tool.name, toolArgs, toolContext)

          if (!result.success) {
            log(`Tool error: ${result.error}`)
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
    } catch (error) {
      if (debug) {
        log(`Skipping tool ${tool.name} - registration failed:`, error instanceof Error ? error.message : error)
      }
      continue
    }
  }

  return server
}

/**
 * Development MCP server for Claude Code integration.
 *
 * This server uses HTTP transport and authenticates via the
 * OPEN_MERCATO_API_KEY environment variable, .mcp.json file,
 * or x-api-key header.
 *
 * Usage:
 *   OPEN_MERCATO_API_KEY=omk_xxx yarn mcp:dev
 *
 * Or configure in .mcp.json for Claude Code with HTTP transport.
 */
export async function runMcpDevServer(): Promise<void> {
  const envApiKey = process.env.OPEN_MERCATO_API_KEY || (await getApiKeyFromMcpJson())
  const port = parseInt(process.env.MCP_DEV_PORT ?? '', 10) || DEFAULT_PORT
  const debug = process.env.MCP_DEBUG === 'true'

  if (!envApiKey) {
    log('Error: OPEN_MERCATO_API_KEY environment variable is required')
    log('')
    log('To get an API key:')
    log('  1. Log into Open Mercato as an admin')
    log('  2. Go to Settings > API Keys')
    log('  3. Create a new key with the required permissions')
    log('')
    log('Then either:')
    log('  - Set environment variable: export OPEN_MERCATO_API_KEY=omk_xxx...')
    log('  - Or configure in .mcp.json with headers.x-api-key')
    process.exit(1)
  }

  log('Starting development MCP HTTP server...')

  // Create DI container
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const container = await createRequestContainer()

  // Authenticate the API key upfront
  log('Authenticating API key...')
  const authResult = await authenticateMcpRequest(envApiKey, container)

  if (!authResult.success) {
    log(`Authentication failed: ${authResult.error}`)
    process.exit(1)
  }

  log(`Authenticated as: ${authResult.keyName}`)
  log(`Tenant: ${authResult.tenantId ?? '(global)'}`)
  log(`Organization: ${authResult.organizationId ?? '(none)'}`)
  log(`Super admin: ${authResult.isSuperAdmin}`)
  log(`Features: ${authResult.features.length > 0 ? authResult.features.join(', ') : '(none)'}`)

  // Load tools
  log('Loading tools...')
  await loadAllModuleTools()

  // Index tools for search (if search service available)
  try {
    const searchService = container.resolve('searchService') as SearchService
    await indexToolsForSearch(searchService)

    const { indexApiEndpoints } = await import('./api-endpoint-index')
    const endpointCount = await indexApiEndpoints(searchService)
    if (endpointCount > 0) {
      log(`Indexed ${endpointCount} API endpoints for discovery`)
    }
  } catch {
    log('Search indexing skipped (search service not available)')
  }

  // Create tool context from auth result
  const toolContext: McpToolContext = {
    tenantId: authResult.tenantId,
    organizationId: authResult.organizationId,
    userId: authResult.userId,
    container,
    userFeatures: authResult.features,
    isSuperAdmin: authResult.isSuperAdmin,
    apiKeySecret: envApiKey,
  }

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)

    // Health check endpoint
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'ok',
        mode: 'development',
        tools: getToolRegistry().listToolNames().length,
        tenant: authResult.tenantId,
        timestamp: new Date().toISOString(),
      }))
      return
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    // Extract and validate API key from header
    const headers: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value[0] : value
    }

    const providedApiKey = extractApiKeyFromHeaders(headers)
    if (!providedApiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'API key required (x-api-key header)' }))
      return
    }

    // Validate against the configured API key
    if (providedApiKey !== envApiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid API key' }))
      return
    }

    if (debug) {
      log(`Authenticated request (${req.method})`)
    }

    try {
      // Create stateless transport
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: req.method === 'POST',
      })

      // Create server with pre-authenticated context (no session tokens needed)
      const mcpServer = createDevMcpServer(toolContext, authResult.features, authResult.isSuperAdmin, debug)

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
        if (debug) {
          log(`Request completed, cleaned up`)
        }
      })
    } catch (error) {
      log('Error handling request:', error)
      if (!res.headersSent) {
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

  log(`Tools registered: ${toolCount}`)
  log(`Endpoint: http://localhost:${port}/mcp`)
  log(`Health: http://localhost:${port}/health`)
  log(`Mode: Development (API key auth, no session tokens)`)

  return new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      log(`Server listening on port ${port}`)
      log('Ready for Claude Code connections')
    })

    const shutdown = async () => {
      log('Shutting down...')
      httpServer.close(() => {
        log('Server closed')
        resolve()
      })
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
}
