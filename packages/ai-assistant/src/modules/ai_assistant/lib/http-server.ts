import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { AwilixContainer } from 'awilix'
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
 * Active session data.
 */
type SessionData = {
  sessionId: string
  keyId: string
  keyName: string
  tenantId: string | null
  organizationId: string | null
  userId: string
  features: string[]
  isSuperAdmin: boolean
  transport: StreamableHTTPServerTransport
  server: Server
  createdAt: Date
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
 * Create an MCP server instance for an authenticated session.
 */
function createSessionServer(
  config: McpServerConfig,
  session: {
    tenantId: string | null
    organizationId: string | null
    userId: string
    features: string[]
    isSuperAdmin: boolean
  },
  container: AwilixContainer
): Server {
  const server = new Server(
    { name: config.name, version: config.version },
    { capabilities: { tools: {} } }
  )

  const toolContext: McpToolContext = {
    tenantId: session.tenantId,
    organizationId: session.organizationId,
    userId: session.userId,
    container,
    userFeatures: session.features,
    isSuperAdmin: session.isSuperAdmin,
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const registry = getToolRegistry()
    const tools = Array.from(registry.getTools().values())

    const accessibleTools = tools.filter((tool) =>
      hasRequiredFeatures(tool.requiredFeatures, session.features, session.isSuperAdmin)
    )

    if (config.debug) {
      console.error(
        `[MCP HTTP] Listing ${accessibleTools.length}/${tools.length} tools (filtered by ACL)`
      )
    }

    return {
      tools: accessibleTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema as any) as Record<string, unknown>,
      })),
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    if (config.debug) {
      console.error(`[MCP HTTP] Calling tool: ${name}`, JSON.stringify(args))
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
 * Check if request is an MCP initialize request.
 */
function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const msg = body as Record<string, unknown>
  return msg.method === 'initialize' && msg.jsonrpc === '2.0'
}

/**
 * Run MCP server with HTTP transport.
 *
 * The server authenticates requests using API keys from the x-api-key header
 * or Authorization: ApiKey header. Each authenticated session gets its own
 * MCP server instance with tools filtered by the API key's permissions.
 */
export async function runMcpHttpServer(options: McpHttpServerOptions): Promise<void> {
  const { config, container, port } = options

  await loadAllModuleTools()

  const sessions = new Map<string, SessionData>()

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    const headers: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value[0] : value
    }

    const sessionId = headers['mcp-session-id']

    if (req.method === 'DELETE' && sessionId) {
      const session = sessions.get(sessionId)
      if (session) {
        try {
          await session.transport.close()
          await session.server.close()
        } catch {
          // Ignore close errors
        }
        sessions.delete(sessionId)
        if (config.debug) {
          console.error(`[MCP HTTP] Session closed: ${sessionId}`)
        }
      }
      res.writeHead(200)
      res.end()
      return
    }

    if (req.method === 'GET' && sessionId) {
      const session = sessions.get(sessionId)
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Session not found' }))
        return
      }
      await session.transport.handleRequest(req, res)
      return
    }

    if (req.method === 'POST') {
      let body: unknown
      try {
        body = await parseJsonBody(req)
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
        return
      }

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!
        await session.transport.handleRequest(req, res, body)
        return
      }

      if (!isInitializeRequest(body)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Session required or initialize first' }))
        return
      }

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

      const newSessionId = randomUUID()

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      })

      const mcpServer = createSessionServer(
        config,
        {
          tenantId: authResult.tenantId,
          organizationId: authResult.organizationId,
          userId: authResult.userId,
          features: authResult.features,
          isSuperAdmin: authResult.isSuperAdmin,
        },
        container
      )

      const sessionData: SessionData = {
        sessionId: newSessionId,
        keyId: authResult.keyId,
        keyName: authResult.keyName,
        tenantId: authResult.tenantId,
        organizationId: authResult.organizationId,
        userId: authResult.userId,
        features: authResult.features,
        isSuperAdmin: authResult.isSuperAdmin,
        transport,
        server: mcpServer,
        createdAt: new Date(),
      }

      sessions.set(newSessionId, sessionData)

      transport.onclose = () => {
        sessions.delete(newSessionId)
        if (config.debug) {
          console.error(`[MCP HTTP] Session closed (transport): ${newSessionId}`)
        }
      }

      await mcpServer.connect(transport)

      if (config.debug) {
        console.error(`[MCP HTTP] New session: ${newSessionId} (key: ${authResult.keyName})`)
      }

      await transport.handleRequest(req, res, body)
      return
    }

    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  })

  const toolCount = getToolRegistry().listToolNames().length

  console.error(`[MCP HTTP] Starting ${config.name} v${config.version}`)
  console.error(`[MCP HTTP] Endpoint: http://localhost:${port}/mcp`)
  console.error(`[MCP HTTP] Tools registered: ${toolCount}`)
  console.error(`[MCP HTTP] Authentication: API key required (x-api-key header)`)

  server.listen(port, () => {
    console.error(`[MCP HTTP] Server listening on port ${port}`)
  })

  const shutdown = async () => {
    console.error('[MCP HTTP] Shutting down...')

    for (const [sessionId, session] of sessions) {
      try {
        await session.transport.close()
        await session.server.close()
      } catch {
        // Ignore close errors
      }
      sessions.delete(sessionId)
    }

    server.close(() => {
      console.error('[MCP HTTP] Server closed')
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
