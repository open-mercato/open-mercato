import { createLogger } from '@open-mercato/shared/lib/logger'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z, type ZodType } from 'zod'
import { getToolRegistry } from './tool-registry'
import { buildPendingApprovalMcpResponse, executeTool } from './tool-executor'
import { loadAllModuleTools, indexToolsForSearch } from './tool-loader'
import { authenticateMcpRequest, extractApiKeyFromHeaders, hasRequiredFeatures } from './auth'
import { jsonSchemaToZod, toSafeZodSchema } from './schema-utils'
import { buildMcpToolAnnotations } from './mcp-tool-annotations'
import {
  collectMcpExposureWarnings,
  filterToolsForCaller,
  isToolExposed,
  buildDirectMutationModeWarning,
  describeMcpExposureConfig,
  resolveMcpExposureConfig,
  type McpExposureCaller,
  type McpExposureConfig,
} from './mcp-exposure'
import { redactSecretForLog, deriveApiKeySessionId } from './log-redaction'
import {
  CORRELATION_ID_HEADER,
  attachCorrelationMeta,
  mapToolResultToAuditOutcome,
  recordMcpToolCall,
  resolveAuditActorUserId,
  resolveCorrelationId,
  type McpAuditOutcome,
  type McpAuditPrincipal,
} from './mcp-audit'
import type { AiToolDefinition, McpServerConfig, McpToolContext } from './types'
import type { SearchService } from '@open-mercato/search/service'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { findApiKeyBySecret, findSessionApiKeyWithSecret } from '@open-mercato/core/modules/api_keys/services/apiKeyService'

const logger = createLogger('ai_assistant').child({ component: 'mcp-http' })

/**
 * Options for the HTTP MCP server.
 */
export type McpHttpServerOptions = {
  config: McpServerConfig
  container: AwilixContainer
  port: number
  exposureConfig?: McpExposureConfig
  cliArgs?: Record<string, unknown>
}

export type McpHttpRequestHandlerOptions = {
  config: McpServerConfig
  container: AwilixContainer
  exposureConfig: McpExposureConfig
  port?: number
}

export type McpHttpRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

const SESSION_TOKEN_HEADER = 'x-om-session-token'

type ResolvedSessionContext = {
  context: McpToolContext
  sessionKeyId: string
}

type McpToolCallResponse = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

function buildToolErrorResponse(payload: Record<string, unknown>): McpToolCallResponse {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload),
      },
    ],
    isError: true,
  }
}

function listRegistryTools(): AiToolDefinition[] {
  return Array.from(getToolRegistry().getTools().values()) as AiToolDefinition[]
}

function listExposedTools(exposureConfig: McpExposureConfig): AiToolDefinition[] {
  return listRegistryTools().filter((tool) => isToolExposed(tool, exposureConfig))
}

function buildExposureHealth(exposureConfig: McpExposureConfig) {
  const exposedTools = listExposedTools(exposureConfig)
  return {
    allowlist: exposureConfig.allow !== null,
    denylistCount: exposureConfig.deny.length,
    mutationMode: exposureConfig.mutationMode,
    toolCount: exposedTools.length,
    agentToolCount: exposedTools.filter((tool) => Boolean(tool.agentRef)).length,
  }
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
): Promise<ResolvedSessionContext | null> {
  try {
    const em = baseContext.container.resolve<EntityManager>('em')
    const rbacService = baseContext.container.resolve<RbacService>('rbacService')

    // Look up ephemeral key by session token with decrypted secret
    const sessionResult = await findSessionApiKeyWithSecret(em, sessionToken)
    if (!sessionResult) {
      if (debug) {
        logger.debug('Session token not found, expired, or secret unavailable', { sessionToken: redactSecretForLog(sessionToken) })
      }
      return null
    }

    const { key: sessionKey, secret: sessionSecret } = sessionResult

    // Load ACL for the session user
    const userId = sessionKey.sessionUserId || sessionKey.createdBy
    if (!userId) {
      if (debug) {
        logger.debug('Session key has no associated user')
      }
      return null
    }

    const acl = await rbacService.loadAcl(`api_key:${sessionKey.id}`, {
      tenantId: sessionKey.tenantId ?? null,
      organizationId: sessionKey.organizationId ?? null,
    })

    if (debug) {
      logger.debug('Session context resolved', {
        userId,
        tenantId: sessionKey.tenantId,
        organizationId: sessionKey.organizationId,
        features: acl.features.length,
        isSuperAdmin: acl.isSuperAdmin,
        hasSessionSecret: !!sessionSecret,
      })
    }

    return {
      sessionKeyId: sessionKey.id,
      context: {
        tenantId: sessionKey.tenantId ?? null,
        organizationId: sessionKey.organizationId ?? null,
        userId,
        container: baseContext.container,
        userFeatures: acl.features,
        isSuperAdmin: acl.isSuperAdmin,
        // Use the decrypted session secret for API calls (not the MCP server key)
        apiKeySecret: sessionSecret,
      },
    }
  } catch (error) {
    if (debug) {
      logger.debug('Error resolving session context', { err: error })
    }
    return null
  }
}

/**
 * Resolve user context from the server-level API key (header-based auth fallback).
 * Used when no session token is provided — loads the API key's ACL for RBAC.
 */
async function resolveApiKeyContext(
  apiKeyRecord: ApiKey,
  baseContext: McpToolContext,
  debug?: boolean
): Promise<McpToolContext | null> {
  try {
    const rbacService = baseContext.container.resolve<RbacService>('rbacService')
    const userId = apiKeyRecord.sessionUserId ?? apiKeyRecord.createdBy
    if (!userId) {
      if (debug) {
        logger.debug('API key has no associated user')
      }
      return null
    }

    const acl = await rbacService.loadAcl(`api_key:${apiKeyRecord.id}`, {
      tenantId: apiKeyRecord.tenantId ?? null,
      organizationId: apiKeyRecord.organizationId ?? null,
    })

    if (debug) {
      logger.debug('API key context resolved', {
        userId,
        tenantId: apiKeyRecord.tenantId,
        organizationId: apiKeyRecord.organizationId,
        features: acl.features.length,
        isSuperAdmin: acl.isSuperAdmin,
      })
    }

    return {
      tenantId: apiKeyRecord.tenantId ?? null,
      organizationId: apiKeyRecord.organizationId ?? null,
      userId,
      container: baseContext.container,
      userFeatures: acl.features,
      isSuperAdmin: acl.isSuperAdmin,
      apiKeySecret: baseContext.apiKeySecret,
    }
  } catch (error) {
    if (debug) {
      logger.debug('Error resolving API key context', { err: error })
    }
    return null
  }
}

function buildApiKeyToolContext(
  apiKeyRecord: ApiKey,
  container: AwilixContainer,
  apiKeySecret: string
): McpToolContext {
  return {
    tenantId: apiKeyRecord.tenantId ?? null,
    organizationId: apiKeyRecord.organizationId ?? null,
    userId: apiKeyRecord.createdBy ?? null,
    container,
    userFeatures: [],
    isSuperAdmin: false,
    apiKeySecret,
  }
}

/**
 * Resolve the `tools/list` principal for an API key secret exactly as the HTTP server does for a
 * request without a session token header. Returns null when the key is unknown or expired.
 */
export async function resolveApiKeyListCaller(
  container: AwilixContainer,
  apiKeySecret: string
): Promise<McpExposureCaller | null> {
  const em = container.resolve<EntityManager>('em')
  const apiKeyRecord = await findApiKeyBySecret(em, apiKeySecret)
  if (!apiKeyRecord) return null
  const toolContext = buildApiKeyToolContext(apiKeyRecord, container, apiKeySecret)
  const apiKeyContext = await resolveApiKeyContext(apiKeyRecord, toolContext)
  const listContext = apiKeyContext ?? toolContext
  return { features: listContext.userFeatures, isSuperAdmin: listContext.isSuperAdmin }
}

/**
 * Resolve the principal whose ACL filters `tools/list` for a request.
 * A session token header selects the session user's ACL; otherwise the server API key's ACL applies.
 * Returns null when the session token header is present but invalid or expired.
 */
async function resolveListPrincipal(
  config: McpServerConfig,
  toolContext: McpToolContext,
  apiKeyRecord: ApiKey,
  sessionHeaderToken: string | undefined
): Promise<McpExposureCaller | null> {
  if (sessionHeaderToken) {
    const resolvedSession = await resolveSessionContext(sessionHeaderToken, toolContext, config.debug)
    if (!resolvedSession) return null
    return { features: resolvedSession.context.userFeatures, isSuperAdmin: resolvedSession.context.isSuperAdmin }
  }
  const apiKeyContext = await resolveApiKeyContext(apiKeyRecord, toolContext, config.debug)
  const listContext = apiKeyContext ?? toolContext
  return { features: listContext.userFeatures, isSuperAdmin: listContext.isSuperAdmin }
}

/**
 * Create a stateless MCP server instance for a single request.
 * Only tools passing the exposure config and the list principal's ACL are registered, so
 * `tools/list` and `tools/call` see the same set. Per-call ACL checks still run at execution time
 * based on the session token provided in each tool call.
 * Returns null when the `x-om-session-token` header is invalid or expired.
 */
async function createMcpServerForRequest(
  config: McpServerConfig,
  toolContext: McpToolContext,
  apiKeyRecord: ApiKey,
  exposureConfig: McpExposureConfig,
  sessionHeaderToken: string | undefined,
  correlationId: string
): Promise<McpServer | null> {
  const listPrincipal = await resolveListPrincipal(config, toolContext, apiKeyRecord, sessionHeaderToken)
  if (!listPrincipal) return null

  const server = new McpServer(
    { name: config.name, version: config.version },
    { capabilities: { tools: {} } }
  )

  const tools = filterToolsForCaller(listRegistryTools(), exposureConfig, listPrincipal)

  if (config.debug) {
    logger.debug('Registering tools filtered for list principal (ACL also checked per-call)', {
      toolCount: tools.length,
      listPrincipal: sessionHeaderToken ? 'session' : 'api_key',
    })
  }

  for (const tool of tools) {
    if (config.debug) {
      logger.debug('Registering tool', { toolName: tool.name })
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
          description: 'Session authorization token. If omitted, the server API key roles are used instead.',
        }
        jsonSchema.properties = properties

        // Convert back to Zod with passthrough to allow extra properties
        const converted = jsonSchemaToZod(jsonSchema)
        // Use type assertion since we know it's an object schema (we added properties above)
        safeSchema = (converted as z.ZodObject<any>).passthrough()
      } catch (error) {
        if (config.debug) {
          logger.debug('Skipping tool: schema conversion failed', { toolName: tool.name, err: error })
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
          annotations: buildMcpToolAnnotations(tool),
        },
        async (args: unknown) => {
          const toolArgs = (args ?? {}) as Record<string, unknown>
          const startedAt = Date.now()

          // Extract session token from args
          const sessionToken = toolArgs._sessionToken as string | undefined
          delete toolArgs._sessionToken // Remove before passing to tool handler

          // Always log tool calls for debugging
          logger.debug('Tool call received', {
            toolName: tool.name,
            hasSessionToken: !!sessionToken,
            argKeys: Object.keys(toolArgs ?? {}).join(','),
            correlationId,
          })

          let effectiveContext = toolContext
          let principal: McpAuditPrincipal = 'api_key'
          let sessionKeyId: string | null = null

          const complete = async (
            response: McpToolCallResponse,
            outcome: McpAuditOutcome,
            errorCode: string | null,
            pendingActionIds: string[] | null = null
          ) => {
            await recordMcpToolCall(toolContext.container, {
              toolName: tool.name,
              tenantId: effectiveContext.tenantId,
              organizationId: effectiveContext.organizationId,
              sessionUserId: principal === 'session' ? effectiveContext.userId : null,
              apiKeySessionUserId: apiKeyRecord.sessionUserId ?? null,
              apiKeyCreatedBy: apiKeyRecord.createdBy ?? null,
              channel: 'mcp',
              mcpServer: 'http',
              apiKeyId: apiKeyRecord.id,
              sessionKeyId,
              principal,
              outcome,
              errorCode,
              durationMs: Date.now() - startedAt,
              isMutation: tool.isMutation === true,
              pendingActionIds,
              correlationId,
              args: toolArgs,
            })
            return attachCorrelationMeta(response, correlationId)
          }

          // Resolve user context from session token
          if (sessionToken) {
            const resolvedSession = await resolveSessionContext(sessionToken, toolContext, config.debug)
            if (resolvedSession) {
              // Session context includes the decrypted API key secret + session ID for memory layer
              effectiveContext = { ...resolvedSession.context, sessionId: sessionToken }
              principal = 'session'
              sessionKeyId = resolvedSession.sessionKeyId
            } else {
              // Session token expired - return user-friendly error for AI to relay
              return complete(
                buildToolErrorResponse({
                  error: 'Your chat session has expired. Please close and reopen the chat window to continue.',
                  code: 'SESSION_EXPIRED',
                }),
                'denied',
                'SESSION_EXPIRED'
              )
            }
          } else {
            // No session token — fall back to header API key auth
            const apiKeyContext = await resolveApiKeyContext(apiKeyRecord, toolContext, config.debug)
            if (apiKeyContext) {
              effectiveContext = apiKeyContext
            } else if (!effectiveContext.userId && effectiveContext.userFeatures.length === 0) {
              return complete(
                buildToolErrorResponse({
                  error: 'Authentication failed: provide a session token (_sessionToken) or a valid API key with assigned roles',
                  code: 'UNAUTHORIZED',
                }),
                'denied',
                'UNAUTHORIZED'
              )
            }

            // Derive a fallback sessionId from the API key so all tool calls
            // within the same MCP connection share a session memory cache
            if (!effectiveContext.sessionId && effectiveContext.apiKeySecret) {
              effectiveContext = {
                ...effectiveContext,
                sessionId: deriveApiKeySessionId(effectiveContext.apiKeySecret),
              }
            }
          }

          // Check if user has required permissions for this tool
          if (tool.requiredFeatures?.length) {
            const rbacService = effectiveContext.container.resolve<RbacService>('rbacService')
            const hasAccess = hasRequiredFeatures(
              tool.requiredFeatures,
              effectiveContext.userFeatures,
              effectiveContext.isSuperAdmin,
              rbacService
            )
            if (!hasAccess) {
              return complete(
                buildToolErrorResponse({
                  error: `Insufficient permissions for tool "${tool.name}". Required: ${tool.requiredFeatures.join(', ')}`,
                  code: 'UNAUTHORIZED',
                }),
                'denied',
                'UNAUTHORIZED'
              )
            }
          }

          try {
            const result = await executeTool(tool.name, toolArgs, effectiveContext, {
              channel: 'mcp',
              mutationMode: exposureConfig.mutationMode,
              requester: {
                userId: resolveAuditActorUserId({
                  sessionUserId: principal === 'session' ? effectiveContext.userId : null,
                  apiKeySessionUserId: apiKeyRecord.sessionUserId ?? null,
                  apiKeyCreatedBy: apiKeyRecord.createdBy ?? null,
                }),
                apiKeyId: principal === 'session' ? null : apiKeyRecord.id,
              },
              correlationId,
            })
            const outcome = mapToolResultToAuditOutcome(result)

            if (result.pendingApproval) {
              return complete(
                buildPendingApprovalMcpResponse(result),
                outcome,
                null,
                [result.pendingApproval.pendingActionId]
              )
            }

            if (!result.success) {
              logger.error('Tool call failed', { toolName: tool.name, err: result.error, code: result.errorCode, correlationId })
              return complete(
                buildToolErrorResponse({ error: result.error, code: result.errorCode }),
                outcome,
                result.errorCode ?? null
              )
            }

            logger.debug('Tool call succeeded', { toolName: tool.name, correlationId })
            return complete(
              {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify(result.result, null, 2),
                  },
                ],
              },
              outcome,
              null
            )
          } catch (err) {
            logger.error('Tool call threw', { toolName: tool.name, err, correlationId })
            return complete(
              buildToolErrorResponse({ error: err instanceof Error ? err.message : 'Unknown error', code: 'EXCEPTION' }),
              'error',
              'EXCEPTION'
            )
          }
        }
      )
    } catch (error) {
      // Skip tools with schemas that can't be registered
      if (config.debug) {
        logger.debug('Skipping tool: registration failed', { toolName: tool.name, err: error })
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
 * Build the HTTP request handler for the MCP server without binding a port.
 */
export function createMcpHttpRequestHandler(options: McpHttpRequestHandlerOptions): McpHttpRequestHandler {
  const { config, container, exposureConfig } = options
  const port = options.port ?? 0

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)

    // Health check endpoint
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'ok',
        tools: getToolRegistry().listToolNames().length,
        exposure: buildExposureHealth(exposureConfig),
        timestamp: new Date().toISOString(),
      }))
      return
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    logger.debug('Request received', { method: req.method, path: url.pathname })

    // Extract headers
    const headers: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value[0] : value
    }

    // Server-level authentication via database lookup
    const providedApiKey = extractApiKeyFromHeaders(headers)
    if (!providedApiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'API key required (x-api-key header)' }))
      return
    }

    // Validate API key against database (prefix lookup + bcrypt verify + expiry check)
    const em = container.resolve<EntityManager>('em')
    const apiKeyRecord = await findApiKeyBySecret(em, providedApiKey)
    if (!apiKeyRecord) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid or expired API key' }))
      return
    }

    if (config.debug) {
      logger.debug('Server-level auth passed', { method: req.method, keyPrefix: apiKeyRecord.keyPrefix })
    }

    // Create base tool context using API key's tenant/org scope
    // Session tokens can override with user-specific permissions
    const toolContext = buildApiKeyToolContext(apiKeyRecord, container, providedApiKey)

    try {
      const mcpServer = await createMcpServerForRequest(
        config,
        toolContext,
        apiKeyRecord,
        exposureConfig,
        headers[SESSION_TOKEN_HEADER],
        resolveCorrelationId(headers[CORRELATION_ID_HEADER])
      )
      if (!mcpServer) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid or expired session token' }))
        return
      }

      // Create stateless transport (no session ID generator = stateless)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: req.method === 'POST',
      })

      if (config.debug) {
        // Check registered tools on the server
        const registeredTools = (mcpServer as any)._registeredTools || {}
        logger.debug('Registered tools in McpServer', { toolNames: Object.keys(registeredTools).join(',') })
        logger.debug('Tool handlers initialized', { initialized: (mcpServer as any)._toolHandlersInitialized })
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
          logger.debug('Request completed, cleaned up')
        }
      })
    } catch (error) {
      logger.error('Error handling request', { err: error })
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
  }
}

function logExposureConfig(exposureConfig: McpExposureConfig): void {
  logger.info('MCP exposure config', describeMcpExposureConfig(exposureConfig, listRegistryTools()))
  for (const warning of collectMcpExposureWarnings(process.env)) {
    logger.warn(warning)
  }
  const directMutationWarning = buildDirectMutationModeWarning(exposureConfig, listRegistryTools())
  if (directMutationWarning) {
    logger.warn(directMutationWarning)
  }
}

/**
 * Run MCP server with HTTP transport (stateless mode).
 *
 * Each request creates a new MCP server instance and transport.
 * The server authenticates requests using API keys from the x-api-key header.
 */
export async function runMcpHttpServer(options: McpHttpServerOptions): Promise<void> {
  const { config, container, port } = options
  const exposureConfig = options.exposureConfig ?? resolveMcpExposureConfig(process.env, options.cliArgs ?? {})

  await loadAllModuleTools()

  // Generate and cache entity graph for understand_entity tool
  try {
    const { extractEntityGraph, cacheEntityGraph } = await import('./entity-graph')
    const { getOrm } = await import('@open-mercato/shared/lib/db/mikro')

    const orm = await getOrm()
    const graph = await extractEntityGraph(orm)
    cacheEntityGraph(graph)
    logger.info('Entity graph generated', { entities: graph.nodes.length, relationships: graph.edges.length })
  } catch (error) {
    logger.warn('Entity graph generation skipped', { err: error })
  }

  // Pre-cache rich OpenAPI spec for Code Mode search tool (prefers runtime module registry over static JSON)
  try {
    const { loadRichOpenApiSpec } = await import('./api-endpoint-index')
    const spec = await loadRichOpenApiSpec()
    if (spec) {
      logger.info('Rich OpenAPI spec cached for Code Mode (with requestBody schemas)')
    } else {
      logger.warn('OpenAPI spec not available')
    }
  } catch (error) {
    logger.warn('OpenAPI spec caching skipped', { err: error })
  }

  // Index tools and entity schemas for hybrid search discovery (if search service available)
  try {
    const searchService = container.resolve('searchService') as SearchService

    // Index MCP tools
    await indexToolsForSearch(searchService)

    // Index entity schemas for hybrid search
    try {
      const { getCachedEntityGraph } = await import('./entity-graph')
      const { indexEntitiesForSearch } = await import('./entity-index')
      const graph = getCachedEntityGraph()
      if (graph) {
        const { count } = await indexEntitiesForSearch(searchService, graph)
        if (count > 0) {
          logger.info('Indexed entity schemas for hybrid search', { count })
        }
      }
    } catch (entityError) {
      logger.warn('Entity schema indexing skipped', { err: entityError })
    }
  } catch (error) {
    // Search service might not be configured - discovery will use fallback
    logger.warn('Search indexing skipped (search service not available)', { err: error })
  }

  logExposureConfig(exposureConfig)

  const httpServer = createServer(createMcpHttpRequestHandler({ config, container, exposureConfig, port }))

  const toolCount = getToolRegistry().listToolNames().length

  logger.info('Starting MCP HTTP server', { name: config.name, version: config.version })
  logger.info('Endpoint ready', { endpoint: `http://localhost:${port}/mcp` })
  logger.info('Health endpoint ready', { endpoint: `http://localhost:${port}/health` })
  logger.info('Tools registered', { toolCount })
  logger.info('Mode: stateless (new server per request)')
  logger.info('Server auth: API key validated against database (x-api-key header)')
  logger.info('User auth: session token (_sessionToken) preferred, falls back to API key roles')

  // Return a Promise that keeps the process alive until shutdown
  return new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      logger.info('Server listening', { port })
    })

    const shutdown = async () => {
      logger.info('Shutting down')
      httpServer.close(() => {
        logger.info('Server closed')
        resolve()
      })
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
}
