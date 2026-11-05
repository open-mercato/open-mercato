import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
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
  resolveAgentToolPendingActionIds,
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
      summary: 'Execute a specific read-only MCP tool by name',
      description: 'Mutation tools must use the agent chat or run-object dispatcher and its mutation approval policy.',
      responses: [
        {
          status: 200,
          description:
            'Tool executed. Returns `{ success: true, result }`. For an agent tool `result` is `{ result, agentId, runId, agentRunId }`.',
        },
      ],
      errors: [
        { status: 400, description: 'Missing tool name, unknown tool, invalid input, or tool execution error.' },
        { status: 401, description: 'Unauthenticated.' },
        { status: 403, description: 'Mutation tools cannot execute directly, or caller lacks tool permissions.' },
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

    const tool = getToolRegistry().getTool(toolName) as AiToolDefinition | undefined
    if (tool?.isMutation === true) {
      await audit('denied', 'DIRECT_MUTATION_DENIED')
      const { t } = await resolveTranslations()
      return NextResponse.json(
        { success: false, error: t('ai_assistant.errors.directMutationDenied') },
        { status: 403 }
      )
    }

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

    const registeredTool = tool
    const toolResultValue = result.success ? result.result : undefined
    await audit(
      mapToolResultToAuditOutcome(result),
      result.errorCode ?? null,
      resolveAgentToolPendingActionIds(registeredTool, toolResultValue),
      resolveAgentToolAuditIds(registeredTool, toolResultValue),
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
