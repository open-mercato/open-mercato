import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { executeTool } from '../../../lib/tool-executor'
import { loadAllModuleTools } from '../../../lib/tool-loader'
import { getToolRegistry } from '../../../lib/tool-registry'
import {
  CORRELATION_ID_HEADER,
  isMutationTool,
  mapToolResultToAuditOutcome,
  recordMcpToolCall,
  resolveCorrelationId,
  type McpAuditOutcome,
} from '../../../lib/mcp-audit'
import { resolveMcpExposureConfig, type McpMutationMode } from '../../../lib/mcp-exposure'
import {
  resolveAgentToolAuditIds,
  toAgentToolCallPayload,
  type AgentToolAuditIds,
} from '../../../lib/mcp-agent-tool-results'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { AiToolDefinition, McpToolContext } from '../../../lib/types'

const logger = createLogger('ai_assistant')

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Execute AI tool',
  methods: {
    POST: {
      summary: 'Execute a specific MCP tool by name',
      responses: [
        {
          status: 200,
          description:
            'Tool executed. Returns `{ success: true, result }`. For an agent tool `result` is `{ result, agentId, runId, agentRunId }`.',
        },
        {
          status: 202,
          description:
            'Mutation queued for approval because `OM_MCP_MUTATION_MODE=approval`. Returns `{ success: true, status: "pending_approval", pendingActionId, expiresAt }`; the tool handler did not run.',
        },
      ],
      errors: [
        { status: 400, description: 'Missing tool name, unknown tool, invalid input, or tool execution error.' },
        { status: 401, description: 'Unauthenticated.' },
        {
          status: 403,
          description:
            'Caller lacks the tool features, the tool is a mutation blocked by `OM_MCP_MUTATION_MODE` (`{ success: false, error, code: "MUTATION_REQUIRES_APPROVAL" }`), or approval mode could not resolve a requesting user (`code: "MUTATION_REQUESTER_UNRESOLVED"`).',
        },
        { status: 500, description: 'Unexpected failure while executing the tool.' },
      ],
    },
  },
}

let cachedMutationMode: { raw: string | undefined; mode: McpMutationMode } | null = null

function resolveToolsApiMutationMode(): McpMutationMode {
  const raw = process.env.OM_MCP_MUTATION_MODE
  if (cachedMutationMode && cachedMutationMode.raw === raw) return cachedMutationMode.mode
  const mode = resolveMcpExposureConfig(process.env, {}).mutationMode
  cachedMutationMode = { raw, mode }
  return mode
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const correlationId = resolveCorrelationId(req.headers.get(CORRELATION_ID_HEADER))
  const startedAt = Date.now()
  let auditedToolName: string | null = null
  let auditedArgs: unknown = {}
  let auditContainer: Awaited<ReturnType<typeof createRequestContainer>> | null = null
  let auditRecorded = false

  const audit = (
    outcome: McpAuditOutcome,
    errorCode: string | null,
    pendingActionIds: string[] | null = null,
    agentAuditIds: AgentToolAuditIds = {},
  ) => {
    if (!auditedToolName || auditRecorded) return Promise.resolve()
    auditRecorded = true
    return recordMcpToolCall(auditContainer, {
      ...agentAuditIds,
      toolName: auditedToolName,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      sessionUserId: auth.isApiKey ? null : auth.sub,
      apiKeySessionUserId: auth.isApiKey ? auth.userId ?? null : null,
      channel: 'tools-api',
      mcpServer: null,
      apiKeyId: auth.isApiKey ? auth.keyId ?? null : null,
      sessionKeyId: null,
      principal: auth.isApiKey ? 'api_key' : 'session',
      outcome,
      errorCode,
      durationMs: Date.now() - startedAt,
      isMutation: isMutationTool(getToolRegistry().getTool(auditedToolName)),
      pendingActionIds,
      correlationId,
      args: auditedArgs,
    })
  }

  try {
    const body = await req.json()
    const { toolName, args = {} } = body

    if (!toolName || typeof toolName !== 'string') {
      return NextResponse.json({ error: 'toolName is required' }, { status: 400 })
    }

    auditedToolName = toolName
    auditedArgs = args

    const container = await createRequestContainer()
    auditContainer = container
    const rbacService = container.resolve<RbacService>('rbacService')

    // Load ACL for user
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    // Ensure tools are loaded
    await loadAllModuleTools()

    // Build tool context
    const toolContext: McpToolContext = {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
      container,
      userFeatures: acl.features,
      isSuperAdmin: acl.isSuperAdmin,
    }

    // Execute the tool
    const result = await executeTool(toolName, args, toolContext, {
      channel: 'tools-api',
      mutationMode: resolveToolsApiMutationMode(),
      requester: {
        userId: auth.isApiKey ? auth.userId ?? null : auth.sub,
        apiKeyId: auth.isApiKey ? auth.keyId ?? null : null,
      },
      correlationId,
    })

    if (result.pendingApproval) {
      const { pendingActionId, expiresAt } = result.pendingApproval
      await audit(mapToolResultToAuditOutcome(result), null, [pendingActionId])
      return NextResponse.json(
        { success: true, status: 'pending_approval', pendingActionId, expiresAt },
        { status: 202 }
      )
    }

    const registeredTool = getToolRegistry().getTool(toolName) as AiToolDefinition | undefined
    await audit(
      mapToolResultToAuditOutcome(result),
      result.errorCode ?? null,
      null,
      resolveAgentToolAuditIds(registeredTool, result.success ? result.result : undefined),
    )

    if (
      result.errorCode === 'MUTATION_REQUIRES_APPROVAL' ||
      result.errorCode === 'MUTATION_REQUESTER_UNRESOLVED'
    ) {
      return NextResponse.json(
        { success: false, error: result.error, code: result.errorCode },
        { status: 403 }
      )
    }

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.errorCode === 'UNAUTHORIZED' ? 403 : 400 }
      )
    }

    const agentPayload = registeredTool ? toAgentToolCallPayload(registeredTool, result.result) : null
    return NextResponse.json({
      success: true,
      result: agentPayload ?? result.result,
    })
  } catch (error) {
    logger.error('AI Tools — Error executing tool', { err: error, correlationId })
    await audit('error', 'EXCEPTION')
    return NextResponse.json(
      { success: false, error: 'Tool execution failed' },
      { status: 500 }
    )
  }
}
