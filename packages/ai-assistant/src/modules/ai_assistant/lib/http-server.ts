import { createLogger } from '@open-mercato/shared/lib/logger'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z, type ZodType } from 'zod'
import { getToolRegistry } from './tool-registry'
import { buildPendingApprovalMcpResponse, executeTool } from './tool-executor'
import { loadAllModuleTools, indexToolsForSearch } from './tool-loader'
import { extractApiKeyFromHeaders, hasRequiredFeatures } from './auth'
import { jsonSchemaToZod, toSafeZodSchema } from './schema-utils'
import { buildMcpToolAnnotations } from './mcp-tool-annotations'
import {
  advertisedOutputZodSchema,
  buildToolSuccessResponse,
  filterRunnableAgentTools,
  resolveAgentToolAuditIds,
  resolveAgentToolPendingActionIds,
  type AgentToolAuditIds,
} from './mcp-agent-tool-results'
import {
  assertValidMcpExposureConfig,
  filterToolsForCaller,
  isToolExposed,
  buildDirectMutationModeWarning,
  describeMcpExposureConfig,
  resolveMcpExposureConfig,
  type McpExposureCaller,
  type McpExposureConfig,
} from './mcp-exposure'
import { runWithMcpToolExecutionObserver } from './mcp-tool-execution-observer'
import {
  CORRELATION_ID_HEADER,
  attachCorrelationMeta,
  isMutationTool,
  mapToolResultToAuditOutcome,
  recordMcpToolCall,
  resolveAuditActorUserId,
  resolveCorrelationId,
  type McpAuditOutcome,
  type McpAuditPrincipal,
} from './mcp-audit'
import { createMcpSdkRefusalAudit, type McpSdkRefusalAudit } from './mcp-sdk-refusal-audit'
import type { AiToolDefinition, McpServerConfig, McpToolContext } from './types'
import type { SearchService } from '@open-mercato/search/service'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { findApiKeyBySecret, findSessionApiKeyWithSecret } from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { resolveVerifiedSessionKeyUserId } from '@open-mercato/core/modules/api_keys/services/sessionKeyRoles'
import { isLoopbackHost, resolveMcpHost } from './mcp-host-resolution'
import { isStaffTenantActive } from '@open-mercato/core/modules/auth/lib/tenantEligibility'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const logger = createLogger('ai_assistant').child({ component: 'mcp-http' })

const MCP_SESSION_TOKEN_REQUIRED_ERROR_KEY = 'ai_assistant.errors.mcpSessionTokenRequired'

/**
 * Options for the HTTP MCP server.
 */
export type McpHttpServerOptions = {
  config: McpServerConfig
  container: AwilixContainer
  port: number
  exposureConfig?: McpExposureConfig
  cliArgs?: Record<string, unknown>
  /**
   * Bind address. Defaults to loopback (`127.0.0.1`) — the only intended client is OpenCode
   * running in Docker, which reaches host loopback via `host.docker.internal` on Docker Desktop.
   * On native Linux `host-gateway` is the bridge IP, so `yarn dev` passes a wider host there
   * (see `resolveDevMcpHost` in `scripts/dev-mcp.mjs`). Omitting a host to `net.Server.listen` binds every interface
   * (`0.0.0.0`/`::`), which exposes the server (and its shared API key) off-host; pass this
   * explicitly to opt into that, paired with a firewall and a strong, rotated key.
   */
  host?: string
  /**
   * Programmatic shutdown trigger, for callers (tests) that need to tear the
   * server down deterministically without sending a process-wide SIGINT/SIGTERM
   * — a real signal would also reach unrelated fixtures sharing the process.
   */
  signal?: AbortSignal
}

export type McpHttpRequestHandlerOptions = {
  config: McpServerConfig
  container: AwilixContainer
  exposureConfig: McpExposureConfig
  port?: number
}

export type McpHttpRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

const SESSION_TOKEN_HEADER = 'x-om-session-token'

async function isConfiguredDelegationKey(presentedKey: string): Promise<boolean> {
  let configuredKey = process.env.MCP_SERVER_API_KEY?.trim()
  const keyFile = process.env.MCP_SERVER_API_KEY_FILE?.trim() || process.env.MCP_API_KEY_FILE?.trim()
  if (!configuredKey && keyFile) {
    try {
      configuredKey = (await readFile(keyFile, 'utf8')).trim()
    } catch {
      return false
    }
  }
  if (!configuredKey) return false
  const expected = Buffer.from(configuredKey)
  const received = Buffer.from(presentedKey)
  return received.length === expected.length && timingSafeEqual(received, expected)
}

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
export async function resolveSessionContext(
  sessionToken: string,
  baseContext: McpToolContext,
  transportKey: ApiKey,
  canDelegate: boolean,
  debug?: boolean
): Promise<ResolvedSessionContext | null> {
  try {
    const em = baseContext.container.resolve<EntityManager>('em')
    const rbacService = baseContext.container.resolve<RbacService>('rbacService')

    // Look up ephemeral key by session token with decrypted secret
    const sessionResult = await findSessionApiKeyWithSecret(em, sessionToken)
    if (!sessionResult) {
      if (debug) {
        logger.debug('Session token not found, expired, or secret unavailable')
      }
      return null
    }

    const { key: sessionKey, secret: sessionSecret } = sessionResult
    if (sessionKey.id !== transportKey.id && !canDelegate) return null
    if (!await isStaffTenantActive(em, sessionKey.tenantId)) return null

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
    const apiKeyUserId = await resolveVerifiedSessionKeyUserId(em, sessionKey)

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
        principalApiKeyId: sessionKey.id,
        ...(apiKeyUserId ? { apiKeyUserId } : {}),
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
export async function resolveApiKeyContext(
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
    const apiKeyUserId = await resolveVerifiedSessionKeyUserId(
      baseContext.container.resolve<EntityManager>('em'),
      apiKeyRecord,
    )

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
      principalApiKeyId: apiKeyRecord.id,
      ...(apiKeyUserId ? { apiKeyUserId } : {}),
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
    principalApiKeyId: apiKeyRecord.id,
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

type ListPrincipal = {
  caller: McpExposureCaller
  principal: McpAuditPrincipal
  tenantId: string | null
  organizationId: string | null
  sessionUserId: string | null
  sessionKeyId: string | null
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
  sessionHeaderToken: string | undefined,
  canDelegate: boolean,
): Promise<ListPrincipal | null> {
  if (sessionHeaderToken) {
    const resolvedSession = await resolveSessionContext(sessionHeaderToken, toolContext, apiKeyRecord, canDelegate, config.debug)
    if (!resolvedSession) return null
    const sessionContext = resolvedSession.context
    return {
      caller: { features: sessionContext.userFeatures, isSuperAdmin: sessionContext.isSuperAdmin },
      principal: 'session',
      tenantId: sessionContext.tenantId,
      organizationId: sessionContext.organizationId,
      sessionUserId: sessionContext.userId,
      sessionKeyId: resolvedSession.sessionKeyId,
    }
  }
  const apiKeyContext = await resolveApiKeyContext(apiKeyRecord, toolContext, config.debug)
  const listContext = apiKeyContext ?? toolContext
  return {
    caller: { features: listContext.userFeatures, isSuperAdmin: listContext.isSuperAdmin },
    principal: 'api_key',
    tenantId: listContext.tenantId,
    organizationId: listContext.organizationId,
    sessionUserId: null,
    sessionKeyId: null,
  }
}

type RefusalAuditOptions = {
  container: AwilixContainer
  apiKeyRecord: ApiKey
  listPrincipal: ListPrincipal
  correlationId: string
}

function createRefusalAudit({
  container,
  apiKeyRecord,
  listPrincipal,
  correlationId,
}: RefusalAuditOptions): McpSdkRefusalAudit {
  return createMcpSdkRefusalAudit(async (call) => {
    const registeredTool = getToolRegistry().getTools().get(call.toolName)
    await recordMcpToolCall(container, {
      ...resolveAgentToolAuditIds(registeredTool),
      toolName: call.toolName,
      tenantId: listPrincipal.tenantId,
      organizationId: listPrincipal.organizationId,
      sessionUserId: listPrincipal.sessionUserId,
      apiKeySessionUserId: apiKeyRecord.sessionUserId ?? null,
      apiKeyCreatedBy: apiKeyRecord.createdBy ?? null,
      channel: 'mcp',
      mcpServer: 'http',
      apiKeyId: apiKeyRecord.id,
      sessionKeyId: listPrincipal.sessionKeyId,
      principal: listPrincipal.principal,
      outcome: mapToolResultToAuditOutcome({ success: false, errorCode: call.errorCode }),
      errorCode: call.errorCode,
      durationMs: call.durationMs,
      isMutation: isMutationTool(registeredTool),
      pendingActionIds: null,
      correlationId,
      args: call.args,
    })
    return correlationId
  })
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
  canDelegate: boolean,
  correlationId: string
): Promise<McpServer | null> {
  const listPrincipal = await resolveListPrincipal(config, toolContext, apiKeyRecord, sessionHeaderToken, canDelegate)
  if (!listPrincipal) return null

  const server = new McpServer(
    { name: config.name, version: config.version },
    { capabilities: { tools: {} } }
  )

  const tools = await filterRunnableAgentTools(
    filterToolsForCaller(listRegistryTools(), exposureConfig, listPrincipal.caller),
    toolContext.container
  )
  const refusalAudit = createRefusalAudit({
    container: toolContext.container,
    apiKeyRecord,
    listPrincipal,
    correlationId,
  })

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
          description: 'Session authorization token. REQUIRED for all tool calls — omitting it fails the call closed.',
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

    const outputSchema = advertisedOutputZodSchema(tool)

    // Wrap in try/catch to handle any remaining edge cases
    try {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: safeSchema,
          ...(outputSchema ? { outputSchema } : {}),
          annotations: buildMcpToolAnnotations(tool),
        },
        async (args: unknown, extra: unknown) => {
          refusalAudit.markHandled(extra)
          const toolArgs = (args ?? {}) as Record<string, unknown>
          const startedAt = Date.now()

          // Extract session token from args
          const argumentToken = typeof toolArgs._sessionToken === 'string' ? toolArgs._sessionToken : undefined
          const sessionToken = sessionHeaderToken ?? argumentToken
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
            pendingActionIds: string[] | null = null,
            agentAuditIds: AgentToolAuditIds = resolveAgentToolAuditIds(tool)
          ) => {
            await recordMcpToolCall(toolContext.container, {
              ...agentAuditIds,
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
            const tokensMatch = !argumentToken || !sessionHeaderToken || argumentToken === sessionHeaderToken
            const resolvedSession = tokensMatch
              ? await resolveSessionContext(sessionToken, toolContext, apiKeyRecord, canDelegate, config.debug)
              : null
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
            // No session token — fail closed rather than silently authorizing this call
            // with the transport key's ACL. The HTTP transport is the chat-facing surface;
            // it has no header-only operator mode. Operator/automation access that must
            // bypass per-user session tokens uses the structurally separate stdio transport
            // (`mcp:serve`, authenticated via `OPEN_MERCATO_API_KEY` or `--user <id>`; the
            // dev/test-only `--allow-unauthenticated-superadmin` flag is not a production
            // substitute), which a chat turn can never reach (#5173).
            const { translate } = await resolveTranslations()
            return complete(
              buildToolErrorResponse({
                error: translate(
                  MCP_SESSION_TOKEN_REQUIRED_ERROR_KEY,
                  'Authentication failed: a session token (_sessionToken) is required for this tool call.'
                ),
                code: 'UNAUTHORIZED',
              }),
              'denied',
              'UNAUTHORIZED'
            )
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
            const executionContext = effectiveContext
            const result = await runWithMcpToolExecutionObserver(
              toolContext.container,
              {
                sessionId: executionContext.sessionId,
                toolName: tool.name,
                tenantId: executionContext.tenantId,
                organizationId: executionContext.organizationId,
                correlationId,
              },
              () =>
                executeTool(tool.name, toolArgs, executionContext, {
                  channel: 'mcp',
                  mutationMode: exposureConfig.mutationMode,
                  requester: {
                    userId: resolveAuditActorUserId({
                      sessionUserId: principal === 'session' ? executionContext.userId : null,
                      apiKeySessionUserId: apiKeyRecord.sessionUserId ?? null,
                      apiKeyCreatedBy: apiKeyRecord.createdBy ?? null,
                    }),
                    apiKeyId: principal === 'session' ? null : apiKeyRecord.id,
                  },
                  correlationId,
                }),
            )
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
              buildToolSuccessResponse(tool, result.result),
              outcome,
              null,
              resolveAgentToolPendingActionIds(tool, result.result),
              resolveAgentToolAuditIds(tool, result.result)
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
      refusalAudit.markRegistered(tool.name)
    } catch (error) {
      // Skip tools with schemas that can't be registered
      if (config.debug) {
        logger.debug('Skipping tool: registration failed', { toolName: tool.name, err: error })
      }
      continue
    }
  }

  refusalAudit.attach(server)
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

    try {
      // Validate API key against database (prefix lookup + bcrypt verify + expiry check)
      const em = container.resolve<EntityManager>('em')
      const apiKeyRecord = await findApiKeyBySecret(em, providedApiKey)
      if (!apiKeyRecord || !await isStaffTenantActive(em, apiKeyRecord.tenantId)) {
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

      const mcpServer = await createMcpServerForRequest(
        config,
        toolContext,
        apiKeyRecord,
        exposureConfig,
        headers[SESSION_TOKEN_HEADER],
        await isConfiguredDelegationKey(providedApiKey),
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
  if (!options.exposureConfig) assertValidMcpExposureConfig(process.env, options.cliArgs ?? {})
  const exposureConfig = options.exposureConfig ?? resolveMcpExposureConfig(process.env, options.cliArgs ?? {})
  const host = resolveMcpHost(options.host, undefined)

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
  logger.info('User auth: session token (_sessionToken) required for every tool call — no header-only fallback')
  if (!isLoopbackHost(host)) {
    logger.warn('Binding beyond loopback — ensure a firewall and a strong, rotated MCP_SERVER_API_KEY', { host })
  }

  // Return a Promise that keeps the process alive until shutdown
  return new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      logger.info('Server listening', { host, port })
    })

    const shutdown = async () => {
      process.off('SIGINT', shutdown)
      process.off('SIGTERM', shutdown)
      logger.info('Shutting down')
      httpServer.close(() => {
        logger.info('Server closed')
        resolve()
      })
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    if (options.signal) {
      if (options.signal.aborted) void shutdown()
      else options.signal.addEventListener('abort', () => void shutdown(), { once: true })
    }
  })
}
