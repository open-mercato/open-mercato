import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getToolRegistry } from '../../lib/tool-registry'
import { toolInputJsonSchema } from '../../lib/tool-input-schema'
import { loadAllModuleTools } from '../../lib/tool-loader'
import { hasRequiredFeatures } from '../../lib/auth'
import {
  MCP_MUTATION_MODES,
  resolveMcpExposureConfig,
  resolveToolHiddenReason,
  type McpToolHiddenReason,
} from '../../lib/mcp-exposure'
import { filterRunnableAgentTools } from '../../lib/mcp-agent-tool-results'
import type { AiToolDefinition } from '../../lib/types'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

const logger = createLogger('ai_assistant')

const toolsListQuerySchema = z.object({
  view: z.enum(['mcp']).optional(),
})

type McpExposureHiddenReason = McpToolHiddenReason | 'agent_unavailable'

const mcpExposureToolSchema = z.object({
  name: z.string(),
  module: z.string(),
  exposed: z.boolean(),
  hiddenReason: z
    .enum(['expose_false', 'denylist', 'not_allowlisted', 'mutation_mode', 'agent_tools_off', 'agent_unavailable'])
    .nullable(),
  isMutation: z.boolean(),
  agentRef: z.object({ agentId: z.string(), engine: z.string() }).nullable(),
})

const mcpExposureResponseSchema = z.object({
  mutationMode: z.enum(['direct', 'deny', 'approval']),
  allowlist: z.array(z.string()).nullable(),
  denylist: z.array(z.string()),
  agentToolsEnabled: z.boolean(),
  tools: z.array(mcpExposureToolSchema),
})

type McpExposureViewResponse = z.infer<typeof mcpExposureResponseSchema>

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'List AI tools',
  methods: {
    GET: {
      summary: 'List available MCP tools filtered by user permissions',
      description:
        'Without `view` returns `{ tools: [{ name, description, inputSchema, module }] }`. With `view=mcp` returns the ' +
        'effective MCP exposure of every tool the caller may use, as the MCP HTTP server would resolve it from this ' +
        `process environment (no CLI flags): mutation mode (${MCP_MUTATION_MODES.join(' | ')}), allow/deny lists, the ` +
        'agent-tools flag and, per tool, `exposed` with a `hiddenReason`.',
      query: toolsListQuerySchema,
      responses: [
        { status: 200, description: 'Tool list, or the MCP exposure view when `view=mcp`.', schema: mcpExposureResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters.' },
        { status: 401, description: 'Unauthenticated.' },
        { status: 500, description: 'Unexpected failure while listing tools.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

type ResolverContainer = {
  resolve<T>(name: string): T
}

function moduleOf(toolName: string): string {
  return toolName.split('.')[0] || 'other'
}

async function buildMcpExposureView(
  tools: AiToolDefinition[],
  container: ResolverContainer,
): Promise<McpExposureViewResponse> {
  const config = resolveMcpExposureConfig(process.env, {})
  const reasons = new Map<string, McpExposureHiddenReason | null>(
    tools.map((tool) => [tool.name, resolveToolHiddenReason(tool, config)]),
  )
  const exposedAgentTools = tools.filter((tool) => tool.agentRef && reasons.get(tool.name) === null)
  const runnableAgentToolNames = new Set(
    (await filterRunnableAgentTools(exposedAgentTools, container)).map((tool) => tool.name),
  )
  for (const tool of exposedAgentTools) {
    if (!runnableAgentToolNames.has(tool.name)) reasons.set(tool.name, 'agent_unavailable')
  }
  return {
    mutationMode: config.mutationMode,
    allowlist: config.allow,
    denylist: config.deny,
    agentToolsEnabled: config.includeAgentTools,
    tools: tools
      .map((tool) => {
        const hiddenReason = reasons.get(tool.name) ?? null
        return {
          name: tool.name,
          module: moduleOf(tool.name),
          exposed: hiddenReason === null,
          hiddenReason,
          isMutation: tool.isMutation === true,
          agentRef: tool.agentRef ? { agentId: tool.agentRef.agentId, engine: tool.agentRef.engine } : null,
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
  }
}

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsedQuery = toolsListQuerySchema.safeParse({ view: url.searchParams.get('view') ?? undefined })
  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  try {
    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')

    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    await loadAllModuleTools()

    const registry = getToolRegistry()
    const allTools = Array.from(registry.getTools().values())

    const accessibleTools = allTools.filter((tool) =>
      hasRequiredFeatures(tool.requiredFeatures, acl.features, acl.isSuperAdmin, rbacService)
    )

    if (parsedQuery.data.view === 'mcp') {
      return NextResponse.json(await buildMcpExposureView(accessibleTools, container))
    }

    const tools = accessibleTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toolInputJsonSchema(tool.inputSchema),
      module: moduleOf(tool.name),
    }))

    return NextResponse.json({ tools })
  } catch (error) {
    logger.error('AI Tools — Error listing tools', { err: error })
    return NextResponse.json({ error: 'Failed to list tools' }, { status: 500 })
  }
}
